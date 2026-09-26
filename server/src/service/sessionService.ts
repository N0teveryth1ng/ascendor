import type {
  Attempt,
  CandidateId,
  DailyTierOutcome,
  ErrorEvent,
  ModuleId,
  Rank,
  SessionResult,
  SessionResultInput,
  SessionSummary,
  StructuralLock,
} from '../core/types.js';
import { MODULES } from '../core/modules.js';
import {
  applyEscalation,
  boundPressureChamber,
  checkEscalation,
  detectStructuralLocks,
  MAX_SUBLEVEL,
  makeLock,
  PRESSURE_CHAMBER_MAX_WINDOW_REDUCTION_PCT,
  recalculate,
  round2,
} from '../core/ape.js';
import {
  accuracyOf,
  computeMetrics,
  deriveFloorsFromCalibration,
  reviseCapabilityBaseline,
  RD_WEIGHT_DELAYED,
  RD_WEIGHT_FRESH,
  sessionAccuracyPct,
  sessionMeanLatencyMs,
} from '../core/metrics.js';
import {
  classifyDailyFailure,
  consequenceForTier,
  evaluateRanks,
  nextMultiplier,
} from '../core/ranks.js';
import { attemptToErrorEvent, renderError } from '../core/errorTags.js';
import {
  activeLockRows,
  activeLocks,
  addPendingRemediation,
  clearErrorCounter,
  clearLock,
  completeRemediations,
  currentRank,
  dailyAggregate,
  dailyLogExists,
  decrementLockSessions,
  getErrorCounters,
  getFloors,
  getPcp,
  getStreak,
  getWindow,
  insertDailyLog,
  insertLock,
  insertRank,
  insertSession,
  lockHistory,
  metricHistory,
  modulesBelowBandToday,
  phaseSessions,
  recentAttemptGroups,
  saveErrorCounters,
  saveStreak,
  saveWindow,
  upsertFloors,
  upsertMetrics,
} from '../db/repo.js';
import { MASTER_WINDOW_DAYS } from '../core/ranks.js';
import { nowIso, previousDay, round2 as r2, todayUtc } from '../util.js';

export class GateError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * Section 11: the APE recalculation is a post-session batch job, never
 * real-time mid-session. Thresholds change session-to-session only, so a
 * candidate is never fighting a moving target inside one execution block.
 */
export function processSessionResult(input: SessionResultInput, itemPayloads: unknown[] = []): SessionResult {
  const pcp = getPcp(input.candidate_id);
  if (!pcp) {
    throw new GateError('CALIBRATION INCOMPLETE — no PCP on file. Drilling endpoints are gated.', 423);
  }

  const attempts = input.attempts;
  if (attempts.length === 0) {
    throw new GateError('EMPTY SESSION — no attempts submitted.', 400);
  }

  const moduleId: ModuleId = input.module_id;
  const descriptor = MODULES[moduleId];

  const before = getWindow(input.candidate_id, moduleId);
  const accuracy = sessionAccuracyPct(attempts);
  const meanLatency = sessionMeanLatencyMs(attempts);

  /* Section 4.3 — the session's error tags. Unique categories, so a recurring
     category is counted once per session for Structural Lock recurrence. */
  const errorTags = [
    ...new Set(
      attempts
        .filter((a) => a.error_code !== 'ACCEPTED' && a.error_code !== 'LATENCY_FAIL')
        .map((a) => a.error_category)
        .filter((c): c is string => Boolean(c)),
    ),
  ];

  const summary: SessionSummary = {
    session_id: input.session_id,
    started_at: input.started_at,
    module_id: moduleId,
    sublevel: before.sublevel,
    accuracy_pct: accuracy,
    mean_latency_ms: meanLatency,
    errors: errorTags,
  };

  /* Section 2.2 — threshold recalculation. */
  const recalc = recalculate(before, summary, descriptor, input.session_id, nowIso());
  let window = recalc.window;

  /* Section 2.3 — structural gap detection. */
  const counters = getErrorCounters(input.candidate_id, moduleId);
  const existing = activeLocks(input.candidate_id);
  const detection = detectStructuralLocks(
    window.last_8_sessions,
    counters,
    existing,
    moduleId,
    nowIso(),
  );
  saveErrorCounters(input.candidate_id, moduleId, detection.counters);

  const locksTriggered: string[] = [];
  const locksCleared: string[] = [];

  // Snapshot locks that existed BEFORE this session's outcome was known, so a
  // lock triggered by this session is not also billed against its own budget.
  const preExisting = activeLockRows(input.candidate_id);

  for (const tag of detection.triggered) {
    insertLock(input.candidate_id, makeLock(tag, moduleId, nowIso()));
    locksTriggered.push(tag);
  }
  for (const tag of detection.cleared) {
    const row = preExisting.find((l) => l.tag === tag && l.module_id === moduleId);
    if (row) {
      clearLock(Number(row.id), nowIso());
      clearErrorCounter(input.candidate_id, moduleId, tag);
      locksCleared.push(tag);
    }
  }
  // Remediation budget burns down one session per session run — starting from
  // the session AFTER the one that triggered it.
  for (const row of preExisting) {
    if (row.module_id === moduleId) decrementLockSessions(Number(row.id));
  }

  const locksNow = activeLocks(input.candidate_id);

  /* Section 2.4 — escalation trigger. All three conditions simultaneously. */
  let escalationReady = false;
  const escalationCheck = checkEscalation(window, descriptor, locksNow);
  escalationReady = escalationCheck.ready && before.sublevel < MAX_SUBLEVEL;
  if (escalationReady) {
    window = applyEscalation(window, MAX_SUBLEVEL, input.session_id);
  }
  window.escalation_ready = escalationReady;
  saveWindow(input.candidate_id, moduleId, window);

  /* Section 7.4.1 — bound the Pressure Chamber's window reduction by the
     candidate's own statistical ceiling. */
  let windowBounded: string | null = null;
  if (moduleId === 'P4_PC') {
    const rollingAccuracy = rollingSessionAccuracy(input.candidate_id);
    const decision = boundPressureChamber(PRESSURE_CHAMBER_MAX_WINDOW_REDUCTION_PCT, rollingAccuracy);
    windowBounded = decision.reason;
  }

  /* Persist. */
  const isDelayed = attempts.some((a) => a.delayed_recall);
  const storedItems = moduleId === 'P1_VSF' ? mergeScenePayload(itemPayloads, isDelayed) : itemPayloads;

  insertSession({
    sessionId: input.session_id,
    candidateId: input.candidate_id,
    moduleId,
    blockId: input.block_id ?? descriptor.block,
    sublevel: before.sublevel,
    startedAt: input.started_at,
    endedAt: input.ended_at,
    accuracyPct: accuracy,
    meanLatencyMs: meanLatency,
    thresholdMs: before.current_threshold_ms,
    speedMultiplier: before.speed_multiplier,
    errors: errorTags,
    ape: {
      adjustment: recalc.window.adjustment_factor_log[recalc.window.adjustment_factor_log.length - 1],
      decision: recalc.decision,
      trends: recalc.trends,
      escalation_reasons: escalationCheck.reasons,
      pressure_chamber_bounded: windowBounded,
    },
    isDelayedRecall: isDelayed,
    recallOfSession: input.delayed_recall_of ?? null,
    attempts,
    items: storedItems.map((p, i) => ({ item_id: `${input.session_id}-${i}`, payload: p })),
  });

  /* Section 3 — metrics over a rolling window, not a single session. */
  const rolling = computeRollingMetrics(input.candidate_id, pcp, locksNow);
  upsertMetrics(input.candidate_id, rolling, rolling.provenance);

  /* Section 8 — the only sanctioned downward path for baseline stats. */
  const { floors } = getFloors(input.candidate_id);
  const hist = metricHistory(input.candidate_id, 8);
  const revision = reviseCapabilityBaseline(rolling, floors, hist);
  if (revision.should_move) {
    // Punitive failure data never reaches this path; it is trend-driven only.
    const { baseline } = getFloors(input.candidate_id);
    upsertFloors(input.candidate_id, floors, revision.new_baseline ?? baseline);
  }

  if (escalationReady) {
    completeRemediations(input.candidate_id, moduleId);
  }

  /* Section 5.2 — daily aggregate, failure tier, streak. */
  const daily = applyDailyTier(input.candidate_id);
  const gradeLog = buildGradeLog(attempts, locksTriggered, daily.forced_repeat);

  /* Section 5.1 — rank gating. */
  const rankChange = evaluateRankChange(input.candidate_id);

  return {
    session_id: input.session_id,
    module_id: moduleId,
    accuracy_pct: accuracy,
    mean_latency_ms: meanLatency,
    threshold_ms: window.current_threshold_ms,
    speed_multiplier: window.speed_multiplier,
    adjustment: window.adjustment_factor_log[window.adjustment_factor_log.length - 1]!,
    structural_locks_triggered: locksTriggered,
    structural_locks_cleared: locksCleared,
    escalation_ready: escalationReady,
    sublevel: window.sublevel,
    rank_change: rankChange,
    // The daily tier is a per-day verdict, so the report that shows it must be
    // the one the candidate just completed. Never lockouts, never baseline cuts.
    daily_tier: applyDailyTier(input.candidate_id),
    grade_log: gradeLog,
  };

  function buildGradeLog(atts: Attempt[], triggered: string[], forcedRepeat: boolean): ErrorEvent[] {
    const log = atts.map(attemptToErrorEvent);
    for (const tag of triggered) {
      // Shown once when the lock fires, not repeated every instance.
      log.push(
        renderError({
          code: 'STRUCTURAL_LOCK_TRIGGERED',
          category: tag,
          input: null,
          expected: null,
          position: null,
          delta_ms: null,
        }),
      );
    }
    if (forcedRepeat) {
      log.push(renderError({ code: 'STREAK_TERMINATED', category: null, input: null, expected: null, position: null, delta_ms: null }));
    }
    return log;
  }
}

/* ── Rolling metrics across the last 8 sessions ───────────────────────────── */

export function computeRollingMetrics(
  candidateId: CandidateId,
  pcp: NonNullable<ReturnType<typeof getPcp>>,
  locks: StructuralLock[],
) {
  const groups = recentAttemptGroups(candidateId, 8);
  const allAttempts = groups.flatMap((g) => g.attempts);
  const fresh = allAttempts.filter((a) => !a.delayed_recall);
  const delayed = allAttempts.filter((a) => a.delayed_recall);

  const last = computeMetrics({
    attempts: allAttempts,
    baseline_reflex_latency_ms: pcp.baseline_reflex_latency_ms,
    baseline_vocal_clarity: pcp.baseline_vocal_clarity,
    delayed_items: delayed,
    fresh_items: fresh,
    active_locks: locks,
  });

  if (groups.length === 0) {
    return {
      precision_index: 0,
      reflex_latency_pct_of_baseline: 0,
      retention_density: 0,
      vocal_clarity_delta: 0,
      pattern_intuition: 0,
      provenance: { rd_provisional: true, sessions_in_rl_window: 0, updated_at: nowIso() },
    };
  }

  /* PI, RL and PTI average across the window so one session cannot zero the
     dashboard or fake mastery. RD uses the delayed-weighted pool directly. */
  const perSession = groups.map((g) => {
    const freshG = g.attempts.filter((a) => !a.delayed_recall);
    const delayedG = g.attempts.filter((a) => a.delayed_recall);
    return computeMetrics({
      attempts: g.attempts,
      baseline_reflex_latency_ms: pcp.baseline_reflex_latency_ms,
      baseline_vocal_clarity: pcp.baseline_vocal_clarity,
      delayed_items: delayedG,
      fresh_items: freshG,
      active_locks: locks,
    });
  });

  const avg = (fn: (m: (typeof perSession)[number]) => number): number =>
    perSession.reduce((acc, m) => acc + fn(m), 0) / perSession.length;

  return {
    precision_index: round2(avg((m) => m.precision_index)),
    reflex_latency_pct_of_baseline: round2(avg((m) => m.reflex_latency_pct_of_baseline)),
    retention_density: round2(last.retention_density),
    vocal_clarity_delta: round2(avg((m) => m.vocal_clarity_delta)),
    pattern_intuition: round2(avg((m) => m.pattern_intuition)),
    provenance: {
      rd_provisional: delayed.length === 0,
      sessions_in_rl_window: groups.length,
      delayed_items: delayed.length,
      fresh_items: fresh.length,
      rd_weights: { fresh: RD_WEIGHT_FRESH, delayed: RD_WEIGHT_DELAYED },
      updated_at: nowIso(),
    },
  };
}

/* ── Section 5.2: daily aggregate and failure tier ────────────────────────── */

export function applyDailyTier(candidateId: CandidateId): DailyTierOutcome {
  const date = todayUtc();
  const { aggregate_pct, sessions } = dailyAggregate(candidateId, date);

  if (sessions === 0) {
    return {
      date,
      aggregate_pct: 0,
      tier: 'NONE',
      streak_before: getStreak(candidateId).current,
      streak_after: getStreak(candidateId).current,
      multiplier_after: getStreak(candidateId).multiplier,
      modules_failed: [],
      forced_repeat: false,
      lockout_applied: false,
      baseline_stats_cut: false,
    };
  }

  const streakBefore = getStreak(candidateId);
  const tier = classifyDailyFailure(aggregate_pct);
  const consequence = consequenceForTier(tier);
  const modulesFailed = tier === 'NONE' ? [] : modulesBelowBandToday(candidateId, date);

  /* Section 5.2 — a streak counts consecutive DAYS, not sessions. Running
     three sessions in one day must still register as day one, so every session
     after the day's first pass leaves the streak untouched. */
  const isFirstPassToday = streakBefore.last_date !== date;
  const continuesPreviousDay = streakBefore.last_date === previousDay(date);

  const streakAfter =
    tier !== 'NONE'
      ? 0
      : isFirstPassToday
        ? continuesPreviousDay
          ? streakBefore.current + 1
          : 1
        : Math.max(streakBefore.current, 1);

  const multiplierAfter =
    tier !== 'NONE'
      ? 1
      : isFirstPassToday
        ? nextMultiplier(continuesPreviousDay ? streakBefore.multiplier : 1, true)
        : streakBefore.multiplier;
  const best = Math.max(streakBefore.best, streakAfter);

  saveStreak(candidateId, {
    current: streakAfter,
    multiplier: multiplierAfter,
    last_date: date,
    best,
  });

  if (consequence.forced_repeat) {
    for (const m of modulesFailed) {
      addPendingRemediation(candidateId, m, null, `daily aggregate ${round2(aggregate_pct)}% below 85%`);
    }
  }

  if (!dailyLogExists(candidateId, date)) {
    insertDailyLog({
      candidateId,
      date,
      aggregatePct: aggregate_pct,
      tier,
      streakBefore: streakBefore.current,
      streakAfter,
      multiplierAfter,
      modulesFailed,
      forcedRepeat: consequence.forced_repeat,
    });
  }

  // Section 5.2: the failure tier deliberately does not touch baseline stats.
  // Streak and rank progress are at stake; capability is not.
  return {
    date,
    aggregate_pct: round2(aggregate_pct),
    tier,
    streak_before: streakBefore.current,
    streak_after: streakAfter,
    multiplier_after: multiplierAfter,
    modules_failed: modulesFailed,
    forced_repeat: consequence.forced_repeat,
    lockout_applied: false,
    baseline_stats_cut: false,
  };
}

/** Mean accuracy across the candidate's recent sessions, for chamber bounds. */
export function rollingSessionAccuracy(candidateId: CandidateId): number {
  const groups = recentAttemptGroups(candidateId, 8);
  if (!groups.length) return 0;
  const accs = groups.map((g) => accuracyOf(g.attempts));
  return r2(accs.reduce((a, b) => a + b, 0) / accs.length);
}

/**
 * P1_VSF scenes are stored as one merged recall payload per session so the
 * same scene can be re-presented >=24h later for RD (Section 3, 7.1.2).
 */
function mergeScenePayload(payloads: unknown[], isDelayed: boolean): unknown[] {
  if (isDelayed) return [];
  // One recall payload PER SCENE. A session can span several scenes, and slot
  // numbers restart at 1 in each — merging them under a single scene_id would
  // hand the 24h recall a scrambled prompt.
  const byScene = new Map<string, { slot: number; expected: string }[]>();
  for (const p of payloads) {
    const o = p as { kind?: string; scene_id?: string; slots?: { slot: number; expected: string }[] };
    if (o?.kind !== 'scene' || !o.scene_id) continue;
    const slots = byScene.get(o.scene_id) ?? [];
    for (const s of o.slots ?? []) slots.push({ slot: Number(s.slot), expected: String(s.expected) });
    byScene.set(o.scene_id, slots);
  }
  return [...byScene.entries()].map(([sceneId, slots]) => ({
    kind: 'scene_recall',
    scene_id: sceneId,
    slots: slots.sort((a, b) => a.slot - b.slot),
  }));
}

/* ── Rank progression ─────────────────────────────────────────────────────── */

function evaluateRankChange(candidateId: CandidateId): { from: Rank; to: Rank } | null {
  const rank = currentRank(candidateId);
  const evalResult = evaluateRanks({
    rank,
    rolling_windows: Object.fromEntries(
      (Object.keys(MODULES) as ModuleId[]).map((id) => [id, getWindow(candidateId, id)]),
    ),
    locks: activeLocks(candidateId),
    lock_history: lockHistory(candidateId),
    phase4_sessions: phaseSessions(candidateId, 4, Date.now() - MASTER_WINDOW_DAYS * 86400000),
    now: new Date(),
  });
  if (evalResult.nextRank && RANK_STRENGTH[evalResult.nextRank] < RANK_STRENGTH[rank]) {
    insertRank(candidateId, evalResult.nextRank);
    return { from: rank, to: evalResult.nextRank };
  }
  return null;
}

const RANK_STRENGTH: Record<Rank, number> = {
  'RANK 03: DECODER': 0,
  'RANK 02: OPERATOR': 1,
  'RANK 01: STRIKER': 2,
  'RANK 00: MASTER': 3,
};

export { r2 };
