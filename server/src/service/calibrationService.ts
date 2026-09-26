import type { CalibrationVectorId, CandidateId, Pcp } from '../core/types.js';
import { buildPcp, type RawPass } from '../core/calibration.js';
import {
  bootstrapCandidate,
  candidateExists,
  createCandidate,
  getPcp,
  initialiseWindows,
  insertCalibrationPass,
  savePcp,
} from '../db/repo.js';
import { computeC1, computeC5 } from '../core/calibration.js';
import { deriveFloorsFromCalibration } from '../core/metrics.js';
import { GateError } from './sessionService.js';
import { MODULES, ALL_MODULE_IDS } from '../core/modules.js';
import { currentRank, insertRank } from '../db/repo.js';

export function ensureCandidate(id: string, displayName?: string): void {
  if (!candidateExists(id)) {
    createCandidate(id, displayName ?? id.toUpperCase());
  }
}

export function calibrationStatus(candidateId: CandidateId): {
  calibrated: boolean;
  pcp: Pcp | null;
  next_vector: string | null;
} {
  const pcp = getPcp(candidateId);
  return {
    calibrated: pcp !== null,
    pcp,
    next_vector: pcp === null ? 'C1' : null,
  };
}

export function recordPass(
  candidateId: CandidateId,
  vector: string,
  passType: 'untimed' | 'timed',
  data: Omit<RawPass, 'vector' | 'pass_type'>,
): void {
  ensureCandidate(candidateId);
  insertCalibrationPass({
    candidateId,
    vector,
    passType,
    accuracyPct: data.total ? (data.correct / data.total) * 100 : 0,
    meanLatencyMs: data.mean_latency_ms,
    thresholdMs: Math.round(data.mean_latency_ms * 1.15),
    wpm: data.wpm ?? null,
    details: {
      band_accuracy: data.band_accuracy ?? null,
      level_accuracy: data.level_accuracy ?? null,
      clarity_by_class: data.clarity_by_class ?? null,
      clarity: data.clarity ?? null,
      correct: data.correct,
      total: data.total,
    },
  });
}

/**
 * Section 11: Calibration is a hard gate in the auth/onboarding flow.
 * Finalising it locks the PCP, bootstraps rolling windows from the seed,
 * and records the entry rank.
 */
export interface FinaliseOptions {
  /**
   * Recalibration is a NEW BASELINE LAYER, not a reset. A calibrated candidate's
   * rolling windows, streak, sessions and rank history must survive it, so
   * overwriting a locked PCP requires this explicit opt-in. Without it the
   * request is refused rather than silently destroying the candidate's track.
   */
  recalibrate?: boolean;
}

export function finaliseCalibration(
  candidateId: CandidateId,
  passes: RawPass[],
  opts: FinaliseOptions = {},
): Pcp {
  const existing = getPcp(candidateId);
  if (existing && !opts.recalibrate) {
    throw new GateError(
      `PCP LOCKED — ${candidateId} is already calibrated (${existing.calibration_date}). ` +
        'Recalibration must be requested explicitly so the existing track is preserved.',
      409,
    );
  }
  if (passes.length === 0) {
    throw new GateError('CALIBRATION INCOMPLETE — no vector results supplied.', 400);
  }
  const required: CalibrationVectorId[] = ['C1', 'C2', 'C3', 'C4', 'C5'];
  const seen = new Set(passes.map((p) => p.vector));
  for (const v of required) {
    if (!seen.has(v)) {
      throw new GateError(`CALIBRATION INCOMPLETE — vector ${v} has no result.`, 400);
    }
    // Section 1.2: untimed-first, timed-second on EVERY vector. The timed pass
    // is what quantifies speed degradation of capability, which the APE needs.
    if (!passes.some((p) => p.vector === v && p.pass_type === 'untimed')) {
      throw new GateError(`CALIBRATION INCOMPLETE — vector ${v} is missing its untimed pass.`, 400);
    }
    if (!passes.some((p) => p.vector === v && p.pass_type === 'timed')) {
      throw new GateError(`CALIBRATION INCOMPLETE — vector ${v} is missing its timed pass.`, 400);
    }
  }

  const pcp = buildPcp(candidateId, passes);
  savePcp(pcp);

  const c1 = computeC1(passes.filter((p) => p.vector === 'C1'));
  const c5 = computeC5(passes.filter((p) => p.vector === 'C5'));
  const floors = deriveFloorsFromCalibration({
    untimed_accuracy_pct: Math.min(c1.untimed_accuracy_pct, c5.untimed_accuracy_pct),
    baseline_reflex_latency_ms: pcp.baseline_reflex_latency_ms,
    typo_vulnerability_index: pcp.typo_vulnerability_index,
  });
  const seedMetrics = {
    precision_index: floors.precision_index,
    reflex_latency_pct_of_baseline: 100,
    retention_density: floors.retention_density,
    vocal_clarity_delta: 0,
    pattern_intuition: 0,
  };

  bootstrapCandidate(candidateId, floors, seedMetrics);
  // On recalibration the track is already live: reseeding every rolling window
  // would wipe the candidate's APE history. Only a first calibration seeds them.
  if (!existing) {
    initialiseWindows(candidateId, pcp.phase_1_entry_difficulty_seed.latency_threshold_ms, {
      ...pcp.phase_1_entry_difficulty_seed.phase1_sublevel,
    });
  }
  if (currentRank(candidateId) !== pcp.entry_rank) {
    insertRank(candidateId, pcp.entry_rank);
  }
  void ALL_MODULE_IDS;
  void MODULES;
  return pcp;
}

export function requirePcp(candidateId: CandidateId): Pcp {
  const pcp = getPcp(candidateId);
  if (!pcp) {
    throw new GateError(
      'CALIBRATION INCOMPLETE — no PCP on file. Phase 1 is locked until the calibration battery is submitted.',
      423,
    );
  }
  return pcp;
}
