import type { CalibrationVectorId, CandidateId, Pcp, SyntaxCeiling, VocabularyBand } from '../core/types.js';
import { buildPcp, type RawPass } from '../core/calibration.js';
import { BAND_ORDER } from '../content/vocab.js';
import { SYNTAX_LEVELS } from '../content/syntax.js';
import { C1_ITEMS_PER_BAND } from '../content/calibrationC1.js';
import { C2_ITEMS_PER_LEVEL } from '../content/calibrationC2.js';
import { MAX_STREAM_WPM, MIN_STREAM_WPM } from '../content/index.js';
import { HttpError } from './httpError.js';
import {
  bootstrapCandidate,
  candidateExists,
  createCandidate,
  getPcp,
  initialiseWindows,
  insertCalibrationPass,
  readCalibrationPasses,
  savePcp,
} from '../db/repo.js';
import { computeC1, computeC5 } from '../core/calibration.js';
import { deriveFloorsFromCalibration } from '../core/metrics.js';
import { GateError } from './sessionService.js';
import { MODULES, ALL_MODULE_IDS } from '../core/modules.js';
import { currentRank, insertRank } from '../db/repo.js';

export async function ensureCandidate(id: string, displayName?: string): Promise<void> {
  if (!(await candidateExists(id))) {
    await createCandidate(id, displayName ?? id.toUpperCase());
  }
}

export async function calibrationStatus(candidateId: CandidateId): Promise<{
  calibrated: boolean;
  pcp: Pcp | null;
  next_vector: string | null;
}> {
  const pcp = await getPcp(candidateId);
  return {
    calibrated: pcp !== null,
    pcp,
    next_vector: pcp === null ? 'C1' : null,
  };
}

/**
 * C1 band scores are only meaningful if the keys are real vocabulary bands and
 * the values are percentages. `deriveVocabularyBand` walks BAND_ORDER and stops
 * at the first key it does not recognise, so a malformed map is not an error
 * there — it silently yields V1. That is precisely how a corrupt pass reached
 * the database: the client keyed scores by a slot-item id, and the engine
 * recorded a V1 baseline as though the measurement were real. Reject at the
 * write boundary instead of storing a number that cannot be interpreted.
 */
function assertC1BandAccuracy(bandAccuracy: unknown): void {
  if (bandAccuracy === undefined || bandAccuracy === null) {
    throw new HttpError(400, 'C1 pass requires band_accuracy');
  }
  if (typeof bandAccuracy !== 'object' || Array.isArray(bandAccuracy)) {
    throw new HttpError(400, 'C1 band_accuracy must be an object keyed by vocabulary band');
  }
  const keys = Object.keys(bandAccuracy as Record<string, unknown>);
  if (keys.length === 0) throw new HttpError(400, 'C1 band_accuracy is empty');
  for (const key of keys) {
    if (!BAND_ORDER.includes(key as VocabularyBand)) {
      throw new HttpError(
        400,
        `C1 band_accuracy key ${JSON.stringify(key)} is not a vocabulary band (expected V1-V12). ` +
          'Scores must be keyed by the band on the served item, never by a parsed item id.',
      );
    }
    const value = (bandAccuracy as Record<string, unknown>)[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
      throw new HttpError(
        400,
        `C1 band_accuracy[${key}] must be a percentage 0-100, got ${JSON.stringify(value)}`,
      );
    }
    // A percentage alone cannot be validated: a client sending a per-band COUNT
    // looks identical to a legitimate score once the count is <= 100, and a
    // count is what the client used to send. With one item per band the only
    // representable scores are 0 and 100, so anything else means the client is
    // not reporting what actually happened. Derived from the item count so this
    // stays correct if the pass size ever changes.
    const allowed = new Set(
      Array.from({ length: C1_ITEMS_PER_BAND + 1 }, (_, k) => Math.round((k / C1_ITEMS_PER_BAND) * 100)),
    );
    if (!allowed.has(value)) {
      throw new HttpError(
        400,
        `C1 band_accuracy[${key}] must be one of [${[...allowed].join(', ')}] because each band ` +
          `contributes ${C1_ITEMS_PER_BAND} item(s) to the pass, but got ${value}. ` +
          'A per-band count and a percentage are not interchangeable here.',
      );
    }
  }
}

/**
 * C2 level scores are meaningful only if the keys are real syntax levels and the
 * values are the percentages a one-item-per-level pass can actually produce.
 * `deriveSyntaxCeiling` walks SYNTAX_LEVELS and stops at the first key it does
 * not recognise, so a malformed map is not an error there — it silently yields
 * S1, the floor. That is exactly what production did: the client had no C2
 * branch at all, every candidate's ceiling came back S1, and the value was
 * stored in the PCP as though it had been measured.
 */
function assertC2LevelAccuracy(levelAccuracy: unknown): void {
  if (levelAccuracy === undefined || levelAccuracy === null) {
    throw new HttpError(400, 'C2 pass requires level_accuracy');
  }
  if (typeof levelAccuracy !== 'object' || Array.isArray(levelAccuracy)) {
    throw new HttpError(400, 'C2 level_accuracy must be an object keyed by syntax level');
  }
  const keys = Object.keys(levelAccuracy as Record<string, unknown>);
  if (keys.length === 0) throw new HttpError(400, 'C2 level_accuracy is empty');
  const allowed = new Set(
    Array.from({ length: C2_ITEMS_PER_LEVEL + 1 }, (_, k) => Math.round((k / C2_ITEMS_PER_LEVEL) * 100)),
  );
  for (const key of keys) {
    if (!SYNTAX_LEVELS.includes(key as SyntaxCeiling)) {
      throw new HttpError(
        400,
        `C2 level_accuracy key ${JSON.stringify(key)} is not a syntax level (expected S1-S8). ` +
          'Scores must be keyed by the level on the served item, never by a parsed item id.',
      );
    }
    const value = (levelAccuracy as Record<string, unknown>)[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || !allowed.has(value)) {
      throw new HttpError(
        400,
        `C2 level_accuracy[${key}] must be one of [${[...allowed].join(', ')}] because each level ` +
          `contributes ${C2_ITEMS_PER_LEVEL} item(s) to the pass, but got ${JSON.stringify(value)}.`,
      );
    }
  }
}

/**
 * C3 measures the highest delivery rate the candidate still comprehends, and
 * that rate is the aural seed for the whole Phase 1 difficulty ladder. The
 * engine clamps generated streams to [90, 420] WPM, so a pass reporting a rate
 * outside that range cannot have come from the content pipeline. Accepting one
 * anyway would seed the ladder from a number the engine could never produce.
 */
function assertC3Wpm(wpm: unknown): void {
  if (wpm === undefined || wpm === null) {
    throw new HttpError(400, 'C3 pass requires wpm');
  }
  if (typeof wpm !== 'number' || !Number.isFinite(wpm)) {
    throw new HttpError(400, `C3 wpm must be a number, got ${JSON.stringify(wpm)}`);
  }
  if (wpm < MIN_STREAM_WPM || wpm > MAX_STREAM_WPM) {
    throw new HttpError(
      400,
      `C3 wpm must be between ${MIN_STREAM_WPM} and ${MAX_STREAM_WPM}, got ${wpm}. ` +
        'That is the range the engine generates streams in; a rate outside it did not come from the pipeline.',
    );
  }
}

export async function recordPass(
  candidateId: CandidateId,
  vector: string,
  passType: 'untimed' | 'timed',
  data: Omit<RawPass, 'vector' | 'pass_type'>,
): Promise<void> {
  await ensureCandidate(candidateId);
  if (vector === 'C1') assertC1BandAccuracy(data.band_accuracy);
  if (vector === 'C2') assertC2LevelAccuracy(data.level_accuracy);
  if (vector === 'C3') assertC3Wpm(data.wpm);

  const total = Number(data.total ?? 0);
  const correct = Number(data.correct ?? 0);
  if (!Number.isInteger(total) || total <= 0) {
    throw new HttpError(400, `A calibration pass must report a positive item count, got ${total}.`);
  }
  if (!Number.isInteger(correct) || correct < 0 || correct > total) {
    throw new HttpError(400, `A calibration pass reporting ${correct} correct out of ${total} items is not a possible result.`);
  }
  if (!Number.isFinite(data.mean_latency_ms) || data.mean_latency_ms < MIN_PASS_LATENCY_MS || data.mean_latency_ms > MAX_PASS_LATENCY_MS) {
    throw new HttpError(
      400,
      `A calibration pass must report a measured mean latency between ${MIN_PASS_LATENCY_MS} and ` +
        `${MAX_PASS_LATENCY_MS}ms, got ${data.mean_latency_ms}. A pass with no timing is not a fast pass: ` +
        'this value seeds the reflex baseline.',
    );
  }
  // The accuracy column and the item counts are written together, so a payload
  // whose two halves disagree is corrupt rather than merely imprecise.
  const accuracyPct = Math.round((correct / total) * 10000) / 100;
  if (data.accuracy_pct !== undefined && Math.abs(accuracyPct - data.accuracy_pct) > 0.01) {
    throw new HttpError(
      400,
      `Reported accuracy ${data.accuracy_pct}% does not match ${correct}/${total} items.`,
    );
  }
  await insertCalibrationPass({
    candidateId,
    vector,
    passType,
    accuracyPct,
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

/**
 * A stored pass carries its accuracy twice: as the `accuracy_pct` column and as
 * the `correct`/`total` item counts inside `details`. Both are written in the
 * same insert, so they cannot legitimately disagree. A mismatch means the row
 * is corrupt, and deriving the ladder from it would seed a ceiling that no
 * observed performance supports — so refuse instead of guessing which half is
 * right.
 */
/**
 * Response latency bounds for a calibration pass. The lower bound is not a
 * quality threshold: a reported 0 is not "infinitely fast", it is an absent
 * measurement, and the client produces exactly that when a pass has no attempts.
 * C5's timed mean latency becomes `baseline_reflex_latency_ms`, which seeds the
 * Phase 1 latency threshold as `baseline * 1.15 * (1 + TVI/2)` clamped to
 * [900, 4000] — so a 0 silently becomes 900, the hardest setting the system can
 * produce, derived from nothing.
 */
const MIN_PASS_LATENCY_MS = 1;
const MAX_PASS_LATENCY_MS = 120_000;

export function assertPassIntegrity(passes: RawPass[]): void {
  for (const p of passes) {
    if (!Number.isInteger(p.correct) || !Number.isInteger(p.total) || p.total <= 0) {
      throw new HttpError(400, `${p.vector}/${p.pass_type} has invalid item counts (${p.correct}/${p.total}).`);
    }
    if (p.correct < 0 || p.correct > p.total) {
      throw new HttpError(400, `${p.vector}/${p.pass_type} claims ${p.correct} correct out of ${p.total}.`);
    }
    if (
      !Number.isFinite(p.mean_latency_ms) ||
      p.mean_latency_ms < MIN_PASS_LATENCY_MS ||
      p.mean_latency_ms > MAX_PASS_LATENCY_MS
    ) {
      throw new HttpError(
        400,
        `${p.vector}/${p.pass_type} has an implausible mean latency of ${p.mean_latency_ms}ms. ` +
          'A pass with no timing is not a fast pass: this value seeds the reflex baseline, ' +
          'and zero would become the tightest response window the system can generate.',
      );
    }
    const derived = Math.round((p.correct / p.total) * 10000) / 100;
    if (typeof p.accuracy_pct !== 'number' || !Number.isFinite(p.accuracy_pct)) {
      throw new HttpError(400, `${p.vector}/${p.pass_type} is missing its stored accuracy.`);
    }
    if (Math.abs(derived - p.accuracy_pct) > 0.01) {
      throw new HttpError(
        400,
        `${p.vector}/${p.pass_type} is internally inconsistent: stored accuracy ${p.accuracy_pct}% ` +
          `but its item counts derive ${derived}%. Refusing to seed a ceiling from a corrupt row.`,
      );
    }
  }
}

export async function finaliseCalibration(
  candidateId: CandidateId,
  opts: FinaliseOptions = {},
): Promise<Pcp> {
  const existing = await getPcp(candidateId);
  if (existing && !opts.recalibrate) {
    throw new GateError(
      `PCP LOCKED — ${candidateId} is already calibrated (${existing.calibration_date}). ` +
        'Recalibration must be requested explicitly so the existing track is preserved.',
      409,
    );
  }

  // The PCP is derived from the recorded passes, never from a request body. The
  // per-vector guards run at write time against these rows, so a client cannot
  // bypass them by supplying its own numbers to finalise.
  const stored = await readCalibrationPasses(candidateId);
  if (stored.length === 0) {
    throw new GateError('CALIBRATION INCOMPLETE — no recorded passes for this candidate.', 400);
  }
  const passes = stored.map((row) => {
    let details: Record<string, unknown>;
    try {
      details = typeof row.details === 'string' ? JSON.parse(row.details) : (row.details as never);
    } catch {
      throw new HttpError(400, `${row.vector}/${row.pass_type} has unreadable details and cannot be used.`);
    }
    return {
      vector: row.vector as CalibrationVectorId,
      pass_type: row.pass_type,
      correct: Number(details.correct),
      total: Number(details.total),
      mean_latency_ms: row.mean_latency_ms,
      wpm: row.wpm === null || row.wpm === undefined ? undefined : Number(row.wpm),
      band_accuracy: details.band_accuracy as RawPass['band_accuracy'],
      level_accuracy: details.level_accuracy as RawPass['level_accuracy'],
      clarity_by_class: details.clarity_by_class as RawPass['clarity_by_class'],
      clarity: details.clarity === undefined ? undefined : Number(details.clarity),
      accuracy_pct: row.accuracy_pct,
    } as RawPass & { accuracy_pct: number };
  });
  assertPassIntegrity(passes);

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
  await savePcp(pcp);

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

  await bootstrapCandidate(candidateId, floors, seedMetrics);
  // On recalibration the track is already live: reseeding every rolling window
  // would wipe the candidate's APE history. Only a first calibration seeds them.
  if (!existing) {
    await initialiseWindows(candidateId, pcp.phase_1_entry_difficulty_seed.latency_threshold_ms, {
      ...pcp.phase_1_entry_difficulty_seed.phase1_sublevel,
    });
  }
  if ((await currentRank(candidateId)) !== pcp.entry_rank) {
    await insertRank(candidateId, pcp.entry_rank);
  }
  void ALL_MODULE_IDS;
  void MODULES;
  return pcp;
}

export async function requirePcp(candidateId: CandidateId): Promise<Pcp> {
  const pcp = await getPcp(candidateId);
  if (!pcp) {
    throw new GateError(
      'CALIBRATION INCOMPLETE — no PCP on file. Phase 1 is locked until the calibration battery is submitted.',
      423,
    );
  }
  return pcp;
}
