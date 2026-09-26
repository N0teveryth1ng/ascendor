import type {
  AdjustmentLogEntry,
  ModuleDescriptor,
  ModuleId,
  RollingWindow,
  SessionSummary,
  StructuralLock,
} from './types.js';

/* ── Section 2.1: rolling performance window ──────────────────────────────── */

export const WINDOW_SIZE = 8;

export interface Trends {
  accuracy_trend_pct: number;
  latency_trend_ms: number;
  mean_accuracy_pct: number;
  mean_latency_ms: number;
  /** Count of sessions landing inside the module target band. */
  sessions_in_band: number;
  /** Trailing run of consecutive in-band sessions. */
  consecutive_in_band: number;
  /** Trailing run of consecutive sessions at or under threshold. */
  consecutive_under_threshold: number;
  sample_size: number;
}

/**
 * Least-squares slope over index. Returns change-per-session.
 */
export function slope(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const meanX = (n - 1) / 2;
  const meanY = values.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    const dx = i - meanX;
    num += dx * ((values[i] as number) - meanY);
    den += dx * dx;
  }
  if (den === 0) return 0;
  return num / den;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function computeTrends(
  sessions: SessionSummary[],
  threshold_ms: number,
  band: { min_pct: number; max_pct: number },
): Trends {
  const accs = sessions.map((s) => s.accuracy_pct);
  const lats = sessions.map((s) => s.mean_latency_ms);
  const n = sessions.length;

  // "over window" = fitted total change across the window span, in pct points.
  const span = Math.max(1, n - 1);
  const accuracy_trend_pct = n >= 2 ? slope(accs) * span : 0;
  const latency_trend_ms = n >= 2 ? slope(lats) * span : 0;

  const mean_accuracy_pct = n ? accs.reduce((a, b) => a + b, 0) / n : 0;
  const mean_latency_ms = n ? lats.reduce((a, b) => a + b, 0) / n : 0;

  let sessions_in_band = 0;
  let consecutive_in_band = 0;
  let consecutive_under_threshold = 0;
  for (const s of sessions) {
    if (s.accuracy_pct >= band.min_pct) sessions_in_band++;
  }
  for (let i = sessions.length - 1; i >= 0; i--) {
    const s = sessions[i] as SessionSummary;
    if (s.accuracy_pct >= band.min_pct) consecutive_in_band++;
    else break;
  }
  for (let i = sessions.length - 1; i >= 0; i--) {
    const s = sessions[i] as SessionSummary;
    if (s.mean_latency_ms <= threshold_ms) consecutive_under_threshold++;
    else break;
  }

  return {
    accuracy_trend_pct,
    latency_trend_ms,
    mean_accuracy_pct,
    mean_latency_ms,
    sessions_in_band,
    consecutive_in_band,
    consecutive_under_threshold,
    sample_size: n,
  };
}

/* ── Section 2.2: threshold recalculation ─────────────────────────────────── */

export const TIGHTEN = 0.93;
export const HOLD = 1.0;
export const LOOSEN = 1.08;

export const TREND_TIGHTEN_PCT = 5;
export const TREND_STABLE_PCT = 2;
export const TREND_LOOSEN_PCT = -8;

/** Minimum sessions before the APE is permitted to move a threshold at all. */
export const MIN_SESSIONS_BEFORE_TUNING = 3;

export interface FactorDecision {
  factor: number;
  reason: AdjustmentLogEntry['reason'];
  explanation: string;
}

export function decideAdjustmentFactor(
  trends: Trends,
  band: { min_pct: number; max_pct: number },
  sampleSize: number,
): FactorDecision {
  if (sampleSize < MIN_SESSIONS_BEFORE_TUNING) {
    return { factor: HOLD, reason: 'INIT', explanation: 'window below minimum sample size — hold' };
  }

  const improvingLatency = trends.latency_trend_ms < 0;
  const inBand = trends.mean_accuracy_pct >= band.min_pct && trends.mean_accuracy_pct <= band.max_pct + 2;

  if (trends.accuracy_trend_pct >= TREND_TIGHTEN_PCT && improvingLatency) {
    return { factor: TIGHTEN, reason: 'TIGHTEN', explanation: 'accuracy up, latency improving' };
  }
  if (trends.accuracy_trend_pct <= TREND_LOOSEN_PCT) {
    return { factor: LOOSEN, reason: 'LOOSEN', explanation: 'sustained accuracy decline — system was overtuned' };
  }
  const stable = Math.abs(trends.accuracy_trend_pct) <= TREND_STABLE_PCT;
  if (stable && inBand) {
    return { factor: HOLD, reason: 'HOLD', explanation: 'within target band — correctly calibrated' };
  }
  return { factor: HOLD, reason: 'HOLD', explanation: 'no qualifying trend — hold' };
}

export interface RecalcResult {
  window: RollingWindow;
  trends: Trends;
  decision: FactorDecision;
}

/**
 * Runs after every session (Section 11: post-session batch job, never
 * mid-session — thresholds change session-to-session only).
 */
export function recalculate(
  previous: RollingWindow,
  session: SessionSummary,
  descriptor: ModuleDescriptor,
  sessionId: string,
  nowIso: string,
): RecalcResult {
  const merged = [...previous.last_8_sessions, session].slice(-WINDOW_SIZE);
  const trends = computeTrends(merged, previous.current_threshold_ms, descriptor.target_band);
  const decision = decideAdjustmentFactor(trends, descriptor.target_band, merged.length);

  const threshold_before = previous.current_threshold_ms;
  const speed_before = previous.speed_multiplier;

  let threshold_after = round2(threshold_before * decision.factor);
  // `speed_multiplier` is a stimulus rate, not a time budget: >1 is faster.
  // TIGHTEN (factor 0.93) shortens the deadline, so the delivered stimulus
  // rate must rise by the same proportion — divide, do not multiply.
  let speed_after = round3(speed_before / decision.factor);
  let clamp_applied: AdjustmentLogEntry['clamp_applied'] = 'NONE';

  if (threshold_after < descriptor.threshold_clamp_ms.min) {
    threshold_after = descriptor.threshold_clamp_ms.min;
    clamp_applied = 'MIN';
  } else if (threshold_after > descriptor.threshold_clamp_ms.max) {
    threshold_after = descriptor.threshold_clamp_ms.max;
    clamp_applied = 'MAX';
  }
  if (speed_after < descriptor.speed_clamp.min) {
    speed_after = descriptor.speed_clamp.min;
    clamp_applied = clamp_applied === 'MIN' ? 'MIN' : clamp_applied === 'MAX' ? 'MAX' : 'MIN_SPEED';
  } else if (speed_after > descriptor.speed_clamp.max) {
    speed_after = descriptor.speed_clamp.max;
    clamp_applied = clamp_applied === 'NONE' ? 'MAX_SPEED' : clamp_applied;
  }

  const logEntry: AdjustmentLogEntry = {
    session_id: sessionId,
    recorded_at: nowIso,
    accuracy_trend_pct: round2(trends.accuracy_trend_pct),
    latency_trend_ms: Math.round(trends.latency_trend_ms),
    factor: decision.factor,
    reason: decision.reason,
    threshold_before_ms: round2(threshold_before),
    threshold_after_ms: threshold_after,
    clamp_applied,
  };

  const consecutive_in_band = trends.consecutive_in_band;

  return {
    trends,
    decision,
    window: {
      last_8_sessions: merged,
      current_threshold_ms: threshold_after,
      speed_multiplier: speed_after,
      adjustment_factor_log: [...previous.adjustment_factor_log, logEntry].slice(-40),
      sublevel: previous.sublevel,
      consecutive_in_band,
      escalation_ready: previous.escalation_ready,
      last_escalated_session_id: previous.last_escalated_session_id ?? null,
    },
  };
}

/**
 * Section 7.4.1 — the Pressure Chamber must not reduce its window below the
 * point where rolling accuracy would statistically drop under 98%. The APE
 * caps escalation here rather than guaranteeing failure.
 */
export const PRESSURE_CHAMBER_MIN_ACCURACY = 98;
export const PRESSURE_CHAMBER_MAX_WINDOW_REDUCTION_PCT = 5;

export function boundPressureChamber(
  requestedReductionPct: number,
  rollingAccuracyPct: number,
): { applied_pct: number; bounded: boolean; reason: string | null } {
  const cap = Math.min(requestedReductionPct, PRESSURE_CHAMBER_MAX_WINDOW_REDUCTION_PCT);
  if (rollingAccuracyPct < PRESSURE_CHAMBER_MIN_ACCURACY) {
    return {
      applied_pct: 0,
      bounded: true,
      reason: `rolling accuracy ${round2(rollingAccuracyPct)}% < ${PRESSURE_CHAMBER_MIN_ACCURACY}% — window reduction halted`,
    };
  }
  return {
    applied_pct: cap,
    bounded: cap < requestedReductionPct,
    reason: cap < requestedReductionPct ? 'reduction capped at 5% per correct answer' : null,
  };
}

/* ── Section 2.4: escalation trigger ──────────────────────────────────────── */

export const ESCALATION_CONSECUTIVE_SESSIONS = 3;

export interface EscalationCheck {
  ready: boolean;
  reasons: string[];
}

/**
 * All three conditions must hold simultaneously — not any single lucky session.
 */
export function checkEscalation(
  window: RollingWindow,
  descriptor: ModuleDescriptor,
  activeLocks: StructuralLock[],
): EscalationCheck {
  const reasons: string[] = [];
  // Only sessions recorded since the last escalation count toward the next one.
  const consumedAt = window.last_escalated_session_id
    ? window.last_8_sessions.findIndex((s) => s.session_id === window.last_escalated_session_id)
    : -1;
  const unconsumed = consumedAt >= 0 ? window.last_8_sessions.slice(consumedAt + 1) : window.last_8_sessions;
  const recent = unconsumed.slice(-ESCALATION_CONSECUTIVE_SESSIONS);
  const enough = recent.length === ESCALATION_CONSECUTIVE_SESSIONS;

  const accOk = enough && recent.every((s) => s.accuracy_pct >= descriptor.target_band.min_pct);
  reasons.push(
    enough
      ? `accuracy >= ${descriptor.target_band.min_pct}% for ${ESCALATION_CONSECUTIVE_SESSIONS} consecutive sessions: ${accOk ? 'MET' : 'NOT MET'}`
      : `fewer than ${ESCALATION_CONSECUTIVE_SESSIONS} sessions in window: NOT MET`,
  );

  const latOk =
    enough && recent.every((s) => s.mean_latency_ms <= window.current_threshold_ms);
  reasons.push(
    enough
      ? `mean latency at or under ${round2(window.current_threshold_ms)}ms across the same window: ${latOk ? 'MET' : 'NOT MET'}`
      : 'latency condition: NOT MET',
  );

  const moduleLocks = activeLocks.filter((l) => l.module_id === descriptor.id && l.remediation_active);
  const lockOk = moduleLocks.length === 0;
  reasons.push(
    lockOk
      ? 'no active Structural Lock on core vectors: MET'
      : `no active Structural Lock on core vectors: NOT MET (${moduleLocks.map((l) => l.tag).join(', ')})`,
  );

  return { ready: accOk && latOk && lockOk, reasons };
}

export function applyEscalation(
  window: RollingWindow,
  maxSublevel: number,
  consumedSessionId: string | null = null,
): RollingWindow {
  const next = Math.min(window.sublevel + 1, maxSublevel);
  return {
    ...window,
    sublevel: next,
    consecutive_in_band: 0,
    escalation_ready: false,
    // Mark the triggering session as consumed so the next escalation needs
    // three NEW in-band sessions.
    last_escalated_session_id: consumedSessionId ?? window.last_escalated_session_id,
  };
}

export const MAX_SUBLEVEL = 6;

/* ── Section 2.3: structural gap detection ────────────────────────────────── */

export const LOCK_RECURRENCE_THRESHOLD = 4;
export const LOCK_CLEAR_THRESHOLD = 2;
export const REMEDIATION_SESSIONS = 3;
export const REMEDIATION_DIVERSION_PCT = 15;
export const REMEDIATION_SPEED_RELIEF = 1.15;

export interface LockDetection {
  triggered: string[];
  cleared: string[];
  /** Persistent per-module per-tag counters, scoped per candidate. */
  counters: Record<string, number>;
}

function counterKey(moduleId: string, tag: string): string {
  return `${moduleId}::${tag}`;
}

/**
 * If the same error_tag recurs across >= 4 sessions in the rolling window,
 * the module does NOT keep escalating difficulty around it.
 */
export function detectStructuralLocks(
  window: SessionSummary[],
  existingCounters: Record<string, number>,
  existingLocks: StructuralLock[],
  moduleId: ModuleId,
  nowIso: string,
): LockDetection {
  const counters: Record<string, number> = { ...existingCounters };
  const tagsThisSession = new Set<string>();

  for (const s of window) {
    if (s.module_id !== moduleId) continue;
    for (const tag of s.errors) tagsThisSession.add(tag);
  }

  const triggered: string[] = [];
  for (const tag of tagsThisSession) {
    // Count distinct sessions the tag appeared in, within the window.
    let sessionsFlagged = 0;
    for (const s of window) {
      if (s.module_id === moduleId && s.errors.includes(tag)) sessionsFlagged++;
    }
    const key = counterKey(moduleId, tag);
    counters[key] = sessionsFlagged;

    const alreadyLocked = existingLocks.some(
      (l) => l.tag === tag && l.module_id === moduleId && l.remediation_active,
    );
    if (!alreadyLocked && sessionsFlagged >= LOCK_RECURRENCE_THRESHOLD) triggered.push(tag);
  }

  const cleared: string[] = [];
  for (const lock of existingLocks) {
    if (!lock.remediation_active || lock.module_id !== moduleId) continue;
    const key = counterKey(moduleId, lock.tag);
    const current = counters[key] ?? 0;
    if (current < LOCK_CLEAR_THRESHOLD) cleared.push(lock.tag);
  }

  void nowIso;
  return { triggered, cleared, counters };
}

export function makeLock(
  tag: string,
  moduleId: ModuleId,
  nowIso: string,
): StructuralLock {
  return {
    tag,
    module_id: moduleId,
    sessions_flagged: LOCK_RECURRENCE_THRESHOLD,
    remediation_active: true,
    triggered_at: nowIso,
    sessions_remaining: REMEDIATION_SESSIONS,
    diversion_pct: REMEDIATION_DIVERSION_PCT,
    cleared_at: null,
    blocks_escalation: true,
  };
}

export function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

export { clamp };
