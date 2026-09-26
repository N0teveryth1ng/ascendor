import type { Attempt, Metrics, MetricFloors, MetricProvenance, ModuleId, StructuralLock } from './types.js';
import { MODULES } from './modules.js';
import { round2, slope } from './ape.js';

/* ── Section 3: five-axis metric calculation ──────────────────────────────── */

export interface MetricInput {
  attempts: Attempt[];
  /** Candidate's own calibration baseline. RL is reported relative to this. */
  baseline_reflex_latency_ms: number;
  baseline_vocal_clarity: number;
  /** Delayed (>=24h) recall items in this attempt set. */
  delayed_items: Attempt[];
  /** Same-session items only, excluding delayed re-presentations. */
  fresh_items: Attempt[];
  active_locks: StructuralLock[];
}

export interface MetricComputation extends Metrics {
  provenance: MetricProvenance;
  details: {
    correct_chars: number;
    total_chars: number;
    mean_latency_ms: number;
    latency_samples: number;
    fresh_recall_pct: number;
    delayed_recall_pct: number;
    pti_eligible: number;
    pti_excluded_locked: number;
    clarity_current: number;
    clarity_samples: number;
  };
}

/**
 * RD weighting (Section 3): same-session recall is worth LESS than 24h-later
 * recall of the same material. This measures learning rather than short-term
 * buffer memory. Weights: fresh = 1, delayed = 2.
 */
export const RD_WEIGHT_FRESH = 1;
export const RD_WEIGHT_DELAYED = 2;

export function computeMetrics(input: MetricInput): MetricComputation {
  const { attempts, fresh_items, delayed_items, active_locks } = input;

  /* Precision Index — character accuracy at the APE-set speed for this session. */
  const correct_chars = attempts.reduce((a, x) => a + x.correct_chars, 0);
  const total_chars = attempts.reduce((a, x) => a + x.counted_chars, 0);
  const precision_index = total_chars > 0 ? (correct_chars / total_chars) * 100 : 0;

  /* Reflex Latency — % of the candidate's OWN baseline, never raw ms. */
  const latencies = attempts.map((a) => a.latency_ms).filter((l) => Number.isFinite(l) && l > 0);
  const mean_latency_ms = latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0;
  const reflex_latency_pct_of_baseline =
    input.baseline_reflex_latency_ms > 0 && mean_latency_ms > 0
      ? (mean_latency_ms / input.baseline_reflex_latency_ms) * 100
      : 0;

  /* Retention Density — delayed recall weighted above fresh recall. */
  const freshRecall = accuracyOf(fresh_items);
  const delayedRecall = accuracyOf(delayed_items);
  let retention_density: number;
  if (delayed_items.length === 0) {
    retention_density = freshRecall;
  } else if (fresh_items.length === 0) {
    retention_density = delayedRecall;
  } else {
    const num = freshRecall * RD_WEIGHT_FRESH + delayedRecall * RD_WEIGHT_DELAYED;
    retention_density = num / (RD_WEIGHT_FRESH + RD_WEIGHT_DELAYED);
  }

  /* Vocal Clarity — reported relative to VC0, tracks improvement not "native" ideal. */
  const claritySamples = attempts
    .map((a) => a.clarity_score)
    .filter((c): c is number => typeof c === 'number' && Number.isFinite(c));
  const clarity_current = claritySamples.length
    ? claritySamples.reduce((a, b) => a + b, 0) / claritySamples.length
    : input.baseline_vocal_clarity;
  const vocal_clarity_delta = clarity_current - input.baseline_vocal_clarity;

  /* Pattern Intuition — errorless slot-substitution rate, locked patterns excluded. */
  const lockedTags = new Set(active_locks.filter((l) => l.remediation_active).map((l) => l.tag));
  const slotModules = new Set<ModuleId>(
    (Object.keys(MODULES) as ModuleId[]).filter((id) => MODULES[id].contributes_pti),
  );
  const slotAttempts = attempts.filter(
    (a) => a.slot_category && slotModules.size > 0 && a.item_kind.startsWith('slot'),
  );
  const eligible = slotAttempts.filter((a) => !a.slot_category || !lockedTags.has(a.slot_category));
  const excluded = slotAttempts.length - eligible.length;
  const pattern_intuition = eligible.length
    ? (eligible.filter((a) => a.correct).length / eligible.length) * 100
    : 0;

  return {
    precision_index: round2(precision_index),
    reflex_latency_pct_of_baseline: round2(reflex_latency_pct_of_baseline),
    retention_density: round2(retention_density),
    vocal_clarity_delta: round2(vocal_clarity_delta),
    pattern_intuition: round2(pattern_intuition),
    provenance: {
      rd_provisional: delayed_items.length === 0,
      sessions_in_rl_window: latencies.length,
      updated_at: new Date().toISOString(),
    },
    details: {
      correct_chars,
      total_chars,
      mean_latency_ms: round2(mean_latency_ms),
      latency_samples: latencies.length,
      fresh_recall_pct: round2(freshRecall),
      delayed_recall_pct: round2(delayedRecall),
      pti_eligible: eligible.length,
      pti_excluded_locked: excluded,
      clarity_current: round2(clarity_current),
      clarity_samples: claritySamples.length,
    },
  };
}

export function accuracyOf(attempts: Attempt[]): number {
  if (attempts.length === 0) return 0;
  return (attempts.filter((a) => a.correct).length / attempts.length) * 100;
}

/* ── Session accuracy ─────────────────────────────────────────────────────── */

export function sessionAccuracyPct(attempts: Attempt[]): number {
  return round2(accuracyOf(attempts));
}

export function sessionMeanLatencyMs(attempts: Attempt[]): number {
  const l = attempts.map((a) => a.latency_ms).filter((x) => Number.isFinite(x) && x > 0);
  if (!l.length) return 0;
  return Math.round(l.reduce((a, b) => a + b, 0) / l.length);
}

/* ── Section 8 + 5.2: baseline immutability ───────────────────────────────── */

export const EMPTY_METRICS: Metrics = {
  precision_index: 0,
  reflex_latency_pct_of_baseline: 0,
  retention_density: 0,
  vocal_clarity_delta: 0,
  pattern_intuition: 0,
};

/** Consecutive sessions of decline required to move the capability baseline. */
export const DEGRADATION_SESSIONS_REQUIRED = 3;
export const IMPROVEMENT_SESSIONS_REQUIRED = 2;

export type MetricKey = keyof Metrics;

export interface BaselineDecision {
  should_move: boolean;
  new_baseline: Metrics;
  rationale: string;
}

/**
 * The capability baseline is IMMUTABLE DOWNWARD except through genuine
 * multi-session performance degradation — a real, sustained trend. Never a
 * single bad day, never a punitive cut (Section 8).
 *
 * This function is the ONLY sanctioned downward path for baseline stats.
 * Penalty code must never call it with failure-tier data.
 */
export function reviseCapabilityBaseline(
  current: Metrics,
  calibrationFloors: MetricFloors,
  history: Partial<Metrics>[],
): BaselineDecision {
  const next: Metrics = { ...current };
  const rationale: string[] = [];

  for (const key of Object.keys(current) as MetricKey[]) {
    const series = history
      .map((h) => h[key])
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    if (series.length < DEGRADATION_SESSIONS_REQUIRED) continue;

    const recent = series.slice(-DEGRADATION_SESSIONS_REQUIRED);
    const declining = recent.every((v, i) => i === 0 || v < (recent[i - 1] as number));
    const trend = slope(series);
    const floor = calibrationFloors[key];

    if (declining && trend < 0) {
      const proposed = recent[recent.length - 1] as number;
      if (proposed < (current[key] as number)) {
        const bounded = Math.max(proposed, floor);
        (next as unknown as Record<string, number>)[key] = bounded;
        rationale.push(
          `${key}: sustained decline over ${DEGRADATION_SESSIONS_REQUIRED} sessions ` +
            `(trend ${round2(trend)}), ${round2(current[key] as number)} -> ${round2(bounded)}` +
            (bounded === floor && proposed < floor ? ' [clamped at calibration floor]' : ''),
        );
      }
    }
  }

  return {
    should_move: rationale.length > 0,
    new_baseline: roundMetric(next),
    rationale: rationale.length ? rationale.join('; ') : 'no qualifying sustained trend',
  };
}

/**
 * Section 5.2: a failure tier costs progress, never capability.
 * This is the only function permitted to touch baseline stats, and it is
 * deliberately a no-op on the downward path. Kept explicit so the invariant
 * is auditable rather than implied.
 */
export function applyFailureTierToStats(_metrics: Metrics, _floors: MetricFloors): Metrics {
  return { ..._metrics };
}

export function deriveFloorsFromCalibration(args: {
  untimed_accuracy_pct: number;
  baseline_reflex_latency_ms: number;
  typo_vulnerability_index: number;
}): MetricFloors {
  return {
    precision_index: round2(args.untimed_accuracy_pct),
    // RL is lower-is-better; the floor is the calibrated baseline itself.
    reflex_latency_pct_of_baseline: 100,
    retention_density: round2(args.untimed_accuracy_pct * 0.9),
    vocal_clarity_delta: 0,
    pattern_intuition: 0,
  };
}

export function roundMetric(m: Metrics): Metrics {
  return {
    precision_index: round2(m.precision_index),
    reflex_latency_pct_of_baseline: round2(m.reflex_latency_pct_of_baseline),
    retention_density: round2(m.retention_density),
    vocal_clarity_delta: round2(m.vocal_clarity_delta),
    pattern_intuition: round2(m.pattern_intuition),
  };
}

/** Direction of improvement, for HUD display. RL is the only lower-is-better axis. */
export const METRIC_DIRECTION: Record<MetricKey, 'HIGHER_BETTER' | 'LOWER_BETTER'> = {
  precision_index: 'HIGHER_BETTER',
  reflex_latency_pct_of_baseline: 'LOWER_BETTER',
  retention_density: 'HIGHER_BETTER',
  vocal_clarity_delta: 'HIGHER_BETTER',
  pattern_intuition: 'HIGHER_BETTER',
};

export const METRIC_LABEL: Record<MetricKey, string> = {
  precision_index: 'PRECISION INDEX (PI)',
  reflex_latency_pct_of_baseline: 'REFLEX LATENCY (% OF PERSONAL BASELINE)',
  retention_density: 'RETENTION DENSITY (RD)',
  vocal_clarity_delta: 'VOCAL CLARITY DELTA (VC)',
  pattern_intuition: 'PATTERN INTUITION (PTI)',
};

export type { MetricFloors };
