import type { ModuleId, Rank, RankGateResult, RollingWindow, StructuralLock } from './types.js';
import { checkEscalation, ESCALATION_CONSECUTIVE_SESSIONS } from './ape.js';
import { MODULES, rankAtLeast, RANK_ORDER, rankIndex } from './modules.js';

/* ── Section 5.2: failure tiers ───────────────────────────────────────────── */

export const DAILY_THRESHOLD_STREAK = 95;
export const DAILY_THRESHOLD_FORCED_REPEAT = 85;

export type FailureTierName = 'NONE' | 'BELOW_95' | 'BELOW_85';

export function classifyDailyFailure(aggregatePct: number): FailureTierName {
  if (aggregatePct < DAILY_THRESHOLD_FORCED_REPEAT) return 'BELOW_85';
  if (aggregatePct < DAILY_THRESHOLD_STREAK) return 'BELOW_95';
  return 'NONE';
}

export interface FailureConsequence {
  tier: FailureTierName;
  /** Streak progress is at stake. Access is never revoked (Section 5.2, Section 8). */
  streak_multiplier_reset: boolean;
  /** Forced repeat run of ONLY the failed modules, at current APE threshold. */
  forced_repeat: boolean;
  lockout_applied: false;
  baseline_stats_cut: false;
  note: string;
}

export function consequenceForTier(tier: FailureTierName): FailureConsequence {
  switch (tier) {
    case 'BELOW_95':
      return {
        tier,
        streak_multiplier_reset: true,
        forced_repeat: false,
        lockout_applied: false,
        baseline_stats_cut: false,
        note: 'streak progress reset to zero — same-day retry permitted',
      };
    case 'BELOW_85':
      return {
        tier,
        streak_multiplier_reset: true,
        forced_repeat: true,
        lockout_applied: false,
        baseline_stats_cut: false,
        note: 'forced repeat of failed modules at current APE threshold — baseline stats untouched',
      };
    case 'NONE':
      return {
        tier,
        streak_multiplier_reset: false,
        forced_repeat: false,
        lockout_applied: false,
        baseline_stats_cut: false,
        note: 'daily threshold met',
      };
  }
}

/** Streak multiplier growth. Resets to 1.0 on a sub-95% day; never to 0. */
export const STREAK_MULTIPLIER_STEP = 0.1;
export const STREAK_MULTIPLIER_CAP = 2.0;

export function nextMultiplier(current: number, metThreshold: boolean): number {
  if (!metThreshold) return 1.0;
  return Math.min(STREAK_MULTIPLIER_CAP, round2(current + STREAK_MULTIPLIER_STEP));
}

/* ── Section 5.1: rank gating ─────────────────────────────────────────────── */

export const MASTER_WINDOW_DAYS = 30;
export const MASTER_MIN_SESSIONS = 10;
export const MASTER_MIN_MEAN_ACCURACY = 98;
export const MASTER_MIN_FLOOR_ACCURACY = 95;
export const STRIKER_CLEAN_LOCK_DAYS = 14;

export interface RankEvalContext {
  rank: Rank;
  rolling_windows: Record<string, RollingWindow>;
  locks: StructuralLock[];
  /** All locks ever created, including cleared, for clean-day computation. */
  lock_history: StructuralLock[];
  phase4_sessions: { started_at: string; accuracy_pct: number }[];
  now: Date;
}

function phase1ModulesSatisfied(ctx: RankEvalContext): { ok: boolean; detail: string[] } {
  const detail: string[] = [];
  let ok = true;
  for (const id of Object.keys(MODULES) as ModuleId[]) {
    if (MODULES[id].phase !== 1) continue;
    const win = ctx.rolling_windows[id];
    if (!win) {
      ok = false;
      detail.push(`${id}: NO SESSIONS`);
      continue;
    }
    const check = checkEscalation(win, MODULES[id], ctx.locks);
    const met = check.ready;
    if (!met) ok = false;
    detail.push(`${id}: ${met ? 'MET' : 'NOT MET'} (sublevel ${win.sublevel})`);
  }
  return { ok, detail };
}

function phase23Satisfied(ctx: RankEvalContext, phases: number[]): { ok: boolean; detail: string[] } {
  const detail: string[] = [];
  let ok = true;
  for (const id of Object.keys(MODULES) as ModuleId[]) {
    if (!phases.includes(MODULES[id].phase)) continue;
    const win = ctx.rolling_windows[id];
    if (!win) {
      ok = false;
      detail.push(`${id}: NO SESSIONS`);
      continue;
    }
    const check = checkEscalation(win, MODULES[id], ctx.locks);
    if (!check.ready) ok = false;
    detail.push(`${id}: ${check.ready ? 'MET' : 'NOT MET'} (sublevel ${win.sublevel})`);
  }
  return { ok, detail };
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function isLockActiveOnDay(lock: StructuralLock, dayStart: Date, dayEnd: Date): boolean {
  const trig = new Date(lock.triggered_at).getTime();
  if (trig > dayEnd.getTime()) return false;
  if (lock.cleared_at === null) return true;
  return new Date(lock.cleared_at).getTime() >= dayStart.getTime();
}

function cleanLockDays(ctx: RankEvalContext, days: number): { ok: boolean; detail: string } {
  const dirty: string[] = [];
  for (let i = 0; i < days; i++) {
    const dayEnd = new Date(ctx.now.getTime() - i * 86400000);
    const dayStart = new Date(dayEnd.getTime() - 86399999);
    const active = ctx.lock_history.filter((l) => isLockActiveOnDay(l, dayStart, dayEnd));
    if (active.length) dirty.push(`${dayKey(dayEnd)}(${active.map((l) => l.tag).join(',')})`);
  }
  return {
    ok: dirty.length === 0,
    detail: dirty.length === 0 ? `${days} consecutive days clear` : `active locks on: ${dirty.join(' ')}`,
  };
}

function masterWindow(ctx: RankEvalContext): { ok: boolean; detail: string; stats: { days: number; sessions: number; accuracy_pct: number; qualifies: boolean } } {
  const cutoff = ctx.now.getTime() - MASTER_WINDOW_DAYS * 86400000;
  const inWindow = ctx.phase4_sessions.filter((s) => new Date(s.started_at).getTime() >= cutoff);
  const sessions = inWindow.length;
  const mean = sessions ? inWindow.reduce((a, s) => a + s.accuracy_pct, 0) / sessions : 0;
  const floor = inWindow.length ? Math.min(...inWindow.map((s) => s.accuracy_pct)) : 0;
  const qualifies =
    sessions >= MASTER_MIN_SESSIONS && mean >= MASTER_MIN_MEAN_ACCURACY && floor >= MASTER_MIN_FLOOR_ACCURACY;
  const stats = {
    days: MASTER_WINDOW_DAYS,
    sessions,
    accuracy_pct: round2(mean),
    qualifies,
  };
  const detail =
    `${sessions}/${MASTER_MIN_SESSIONS} sessions in ${MASTER_WINDOW_DAYS}d window, ` +
    `mean ${round2(mean)}% (need ${MASTER_MIN_MEAN_ACCURACY}%), floor ${round2(floor)}% (need ${MASTER_MIN_FLOOR_ACCURACY}%)`;
  return { ok: qualifies, detail, stats };
}

/**
 * Returns every rank at or above the current one that is now satisfied,
 * plus the full requirement breakdown for the next rank.
 */
export function evaluateRanks(ctx: RankEvalContext): {
  requirements: RankGateResult[];
  nextRank: Rank | null;
  master_stats: { days: number; sessions: number; accuracy_pct: number; qualifies: boolean };
} {
  const requirements: RankGateResult[] = [];

  const p1 = phase1ModulesSatisfied(ctx);
  requirements.push({
    rank: 'RANK 02: OPERATOR',
    satisfied: p1.ok,
    requirements: [
      {
        label: `${ESCALATION_CONSECUTIVE_SESSIONS}-consecutive-session escalation trigger on ALL Phase 1 modules`,
        met: p1.ok,
        detail: p1.detail.join(' | '),
      },
    ],
  });

  const p23 = phase23Satisfied(ctx, [2, 3]);
  const clean = cleanLockDays(ctx, STRIKER_CLEAN_LOCK_DAYS);
  const strikerOk = p23.ok && clean.ok;
  requirements.push({
    rank: 'RANK 01: STRIKER',
    satisfied: strikerOk,
    requirements: [
      { label: 'Phase 2 + 3 escalation triggers met', met: p23.ok, detail: p23.detail.join(' | ') },
      {
        label: `zero active Structural Locks for ${STRIKER_CLEAN_LOCK_DAYS} consecutive days`,
        met: clean.ok,
        detail: clean.detail,
      },
    ],
  });

  const master = masterWindow(ctx);
  requirements.push({
    rank: 'RANK 00: MASTER',
    satisfied: master.ok,
    requirements: [
      {
        label: `sustained Phase 4 performance >= ${MASTER_MIN_MEAN_ACCURACY}% across a ${MASTER_WINDOW_DAYS}-day rolling window`,
        met: master.ok,
        detail: master.detail,
      },
    ],
  });

  // Highest rank already satisfied that is STRONGER than the current one.
  // RANK_ORDER is weakest-first, so stronger ranks sit at higher indices.
  // Searching `slice(0, currentIndex)` would only ever find a demotion.
  const next =
    RANK_ORDER.slice(rankIndex(ctx.rank) + 1)
      .reverse()
      .find((r) => requirements.find((q) => q.rank === r)?.satisfied) ?? null;

  return { requirements, nextRank: next, master_stats: master.stats };
}

export function canUnlockPhase(phase: 1 | 2 | 3 | 4, currentRank: Rank, required: Rank | null): boolean {
  if (required === null) return true;
  return rankAtLeast(currentRank, required);
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
