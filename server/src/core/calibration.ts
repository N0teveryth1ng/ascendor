import type {
  CalibrationVectorId,
  CalibrationVectorResult,
  Pcp,
  Phase1EntryDifficultySeed,
  SyntaxCeiling,
  VocabularyBand,
} from './types.js';
import { BAND_ORDER, deriveVocabularyBand } from '../content/vocab.js';
import { deriveSyntaxCeiling } from '../content/syntax.js';
import { AURAL_ACCURACY_FLOOR_PCT } from '../content/dictation.js';
import { FLAG_PHONEME_MAP } from '../content/vocal.js';
import { clamp, nowIso, round2 } from '../util.js';

/**
 * Section 1.2: Calibration is untimed-first, timed-second on every vector.
 * The untimed pass measures capability. The timed pass measures how much
 * speed degrades that capability — which is what the APE actually needs.
 */
export interface RawPass {
  vector: CalibrationVectorId;
  pass_type: 'untimed' | 'timed';
  correct: number;
  total: number;
  mean_latency_ms: number;
  /**
   * The stored accuracy column. Not read by the derivations, which work from
   * `correct`/`total`, but retained so the two can be cross-checked: a row whose
   * accuracy column disagrees with its own item counts is corrupt and must not
   * seed a ceiling.
   */
  accuracy_pct?: number;
  /** C3 only. */
  wpm?: number;
  /** C1 only: accuracy keyed by band. */
  band_accuracy?: Partial<Record<VocabularyBand, number>>;
  /** C2 only: accuracy keyed by level. */
  level_accuracy?: Partial<Record<SyntaxCeiling, number>>;
  /** C4 only: clarity keyed by phoneme class, 0-100. */
  clarity_by_class?: Record<string, number>;
  /** C4 only: clarity scored for each targeted phoneme class. */
  clarity?: number;
}

export interface C1Outcome {
  vocabulary_band: VocabularyBand;
  untimed_accuracy_pct: number;
  band_accuracy: Partial<Record<VocabularyBand, number>>;
}

export function computeC1(passes: RawPass[]): C1Outcome {
  const untimed = passes.find((p) => p.pass_type === 'untimed');
  const bandAccuracy = untimed?.band_accuracy ?? {};
  let correct = 0;
  let total = 0;
  for (const band of BAND_ORDER) {
    const acc = bandAccuracy[band];
    if (acc === undefined) continue;
    const bItems = untimed?.total ? Math.max(1, Math.round(untimed.total / BAND_ORDER.length)) : 0;
    correct += (bItems * acc) / 100;
    total += bItems;
  }
  return {
    vocabulary_band: deriveVocabularyBand(bandAccuracy),
    untimed_accuracy_pct: total ? round2((correct / total) * 100) : 0,
    band_accuracy: bandAccuracy,
  };
}

export function computeC2(passes: RawPass[]): { syntax_ceiling: SyntaxCeiling; untimed_accuracy_pct: number } {
  const untimed = passes.find((p) => p.pass_type === 'untimed');
  const levelAccuracy = untimed?.level_accuracy ?? {};
  return {
    syntax_ceiling: deriveSyntaxCeiling(
      Object.entries(levelAccuracy).map(([level, acc]) => ({ level: level as SyntaxCeiling, accuracy_pct: acc })),
    ),
    untimed_accuracy_pct: untimed ? round2((untimed.correct / Math.max(1, untimed.total)) * 100) : 0,
  };
}

/** C3: the WPM where accuracy drops below 90% is the baseline RL seed. */
export function computeC3(passes: RawPass[]): { max_intelligible_wpm: number; accuracy_by_wpm: Record<number, number> } {
  const byWpm: Record<number, number> = {};
  let maxWpm = 0;
  for (const p of passes) {
    if (p.wpm === undefined) continue;
    const acc = (p.correct / Math.max(1, p.total)) * 100;
    byWpm[p.wpm] = round2(acc);
    if (acc >= AURAL_ACCURACY_FLOOR_PCT) maxWpm = Math.max(maxWpm, p.wpm);
  }
  return { max_intelligible_wpm: maxWpm, accuracy_by_wpm: byWpm };
}

/**
 * A phoneme class is a weak vector when it falls below this ratio of the
 * candidate's own mean clarity for the measured classes.
 */
export const VOCAL_WEAK_CLASS_RATIO = 0.85;

/**
 * C4 is scored for clarity, not accent. It flags physical mechanics issues
 * and specific phoneme substitutions against the candidate's own mechanics,
 * never against a native-speaker ideal.
 */
export function computeC4(passes: RawPass[]): {
  baseline_vocal_clarity: number;
  flagged_weak_vectors: string[];
  clarity_by_class: Record<string, number>;
} {
  const timed = passes.find((p) => p.pass_type === 'timed');
  const untimed = passes.find((p) => p.pass_type === 'untimed');
  const clarity = timed?.clarity ?? untimed?.clarity ?? 0;
  const byClass = timed?.clarity_by_class ?? untimed?.clarity_by_class ?? {};

  const flagged: string[] = [];
  const values = Object.values(byClass);
  if (values.length >= 2) {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    // Scale-invariant against the candidate's own mechanics: flag classes
    // meaningfully weaker than the rest of their own range, never against an
    // external ideal.
    for (const [cls, score] of Object.entries(byClass)) {
      if (score < mean * VOCAL_WEAK_CLASS_RATIO) {
        const flag = Object.entries(FLAG_PHONEME_MAP).find(([, c]) => c === cls)?.[0];
        flagged.push(flag ?? cls);
      }
    }
  }
  return { baseline_vocal_clarity: round2(clarity), flagged_weak_vectors: [...new Set(flagged)], clarity_by_class: byClass };
}

/**
 * C5: untimed dictation first (accuracy ceiling), then the same content at
 * increasing speed. TVI measures the collapse: 0 = no degradation under
 * speed, 1 = total collapse.
 */
export function computeC5(passes: RawPass[]): {
  typo_vulnerability_index: number;
  untimed_accuracy_pct: number;
  baseline_reflex_latency_ms: number;
} {
  const untimed = passes.find((p) => p.pass_type === 'untimed');
  const timed = passes.find((p) => p.pass_type === 'timed');
  const uAcc = untimed ? (untimed.correct / Math.max(1, untimed.total)) * 100 : 0;
  const tAcc = timed ? (timed.correct / Math.max(1, timed.total)) * 100 : 0;
  const tvi = uAcc > 0 ? clamp((uAcc - tAcc) / uAcc, 0, 1) : 1;
  const baselineLatency = Math.round(timed?.mean_latency_ms ?? untimed?.mean_latency_ms ?? 2400);
  return { typo_vulnerability_index: round2(tvi), untimed_accuracy_pct: round2(uAcc), baseline_reflex_latency_ms: baselineLatency };
}

/* ── PCP assembly ─────────────────────────────────────────────────────────── */

export function buildPcp(candidateId: string, passes: RawPass[]): Pcp {
  const c1 = computeC1(passes.filter((p) => p.vector === 'C1'));
  const c2 = computeC2(passes.filter((p) => p.vector === 'C2'));
  const c3 = computeC3(passes.filter((p) => p.vector === 'C3'));
  const c4 = computeC4(passes.filter((p) => p.vector === 'C4'));
  const c5 = computeC5(passes.filter((p) => p.vector === 'C5'));

  const vectors: CalibrationVectorResult[] = [];
  for (const v of ['C1', 'C2', 'C3', 'C4', 'C5'] as CalibrationVectorId[]) {
    const u = passes.find((p) => p.vector === v && p.pass_type === 'untimed');
    const t = passes.find((p) => p.vector === v && p.pass_type === 'timed');
    vectors.push({
      vector: v,
      untimed: {
        accuracy_pct: u ? round2((u.correct / Math.max(1, u.total)) * 100) : 0,
        errors: u ? u.total - u.correct : 0,
        total: u?.total ?? 0,
      },
      timed: {
        accuracy_pct: t ? round2((t.correct / Math.max(1, t.total)) * 100) : 0,
        mean_latency_ms: Math.round(t?.mean_latency_ms ?? 0),
        threshold_ms: Math.round((t?.mean_latency_ms ?? 2400) * 1.15),
      },
      readout: readoutFor(v, { c1, c2, c3, c4, c5 }),
      completed_at: nowIso(),
    });
  }

  const syntaxFlags = syntaxWeakVectors(passes.filter((p) => p.vector === 'C2'));
  const flagged = [...new Set([...c4.flagged_weak_vectors, ...syntaxFlags])];

  const seed = deriveSeed({ c1, c2, c3, c4, c5 });

  return {
    candidate_id: candidateId,
    calibration_date: nowIso(),
    vocabulary_band: c1.vocabulary_band,
    syntax_ceiling: c2.syntax_ceiling,
    baseline_reflex_latency_ms: c5.baseline_reflex_latency_ms,
    baseline_vocal_clarity: c4.baseline_vocal_clarity,
    typo_vulnerability_index: c5.typo_vulnerability_index,
    flagged_weak_vectors: flagged,
    entry_rank: entryRankFor({ c1, c2, c3, c5 }),
    phase_1_entry_difficulty_seed: seed,
    vectors,
    locked: true,
  };
}

function readoutFor(
  v: CalibrationVectorId,
  r: { c1: C1Outcome; c2: { syntax_ceiling: SyntaxCeiling; untimed_accuracy_pct: number }; c3: ReturnType<typeof computeC3>; c4: ReturnType<typeof computeC4>; c5: ReturnType<typeof computeC5> },
): Record<string, number | string> {
  switch (v) {
    case 'C1':
      return { vocabulary_band: r.c1.vocabulary_band, untimed_accuracy_pct: r.c1.untimed_accuracy_pct, bands_cleared: Object.keys(r.c1.band_accuracy).length };
    case 'C2':
      return { syntax_ceiling: r.c2.syntax_ceiling, untimed_accuracy_pct: r.c2.untimed_accuracy_pct };
    case 'C3':
      return { max_intelligible_wpm: r.c3.max_intelligible_wpm, accuracy_floor_pct: AURAL_ACCURACY_FLOOR_PCT };
    case 'C4':
      return { vocal_clarity: r.c4.baseline_vocal_clarity, flagged: r.c4.flagged_weak_vectors.join(',') || 'none' };
    case 'C5':
      return { typo_vulnerability_index: r.c5.typo_vulnerability_index, baseline_reflex_latency_ms: r.c5.baseline_reflex_latency_ms };
  }
}

function syntaxWeakVectors(passes: RawPass[]): string[] {
  const untimed = passes.find((p) => p.pass_type === 'untimed');
  const byLevel = untimed?.level_accuracy ?? {};
  const out: string[] = [];
  if ((byLevel.S4 ?? 100) < 90) out.push('past_perfect_construction');
  if ((byLevel.S5 ?? 100) < 90) out.push('passive_voice');
  if ((byLevel.S6 ?? 100) < 90) out.push('relative_clause');
  if ((byLevel.S7 ?? 100) < 90) out.push('conditional_construction');
  return out;
}

/**
 * Section 5.1: entry rank varies by PCP, not universal. A candidate who
 * clears the OPERATOR evidence bar at calibration does not start at DECODER.
 */
export function entryRankFor(r: {
  c1: C1Outcome;
  c2: { syntax_ceiling: SyntaxCeiling };
  c3: ReturnType<typeof computeC3>;
  c5: ReturnType<typeof computeC5>;
}): Pcp['entry_rank'] {
  const c5Floor = r.c5.typo_vulnerability_index <= 0.06 && r.c5.untimed_accuracy_pct >= 98;
  const c1Floor = r.c1.untimed_accuracy_pct >= 95;
  const c2Floor = ['S5', 'S6', 'S7', 'S8'].includes(r.c2.syntax_ceiling);
  const c3Floor = r.c3.max_intelligible_wpm >= 200;
  return c1Floor && c2Floor && c3Floor && c5Floor ? 'RANK 02: OPERATOR' : 'RANK 03: DECODER';
}

const S_SYNTAX = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8'];

function deriveSeed(r: {
  c1: C1Outcome;
  c2: { syntax_ceiling: SyntaxCeiling };
  c3: ReturnType<typeof computeC3>;
  c4: ReturnType<typeof computeC4>;
  c5: ReturnType<typeof computeC5>;
}): Phase1EntryDifficultySeed {
  const { c1, c2, c3, c5 } = r;
  const syntaxIndex = S_SYNTAX.indexOf(c2.syntax_ceiling);
  const bandIndex = BAND_ORDER.indexOf(c1.vocabulary_band);

  // Threshold sits above the candidate's demonstrated timed latency, scaled by
  // how much their accuracy degrades under speed.
  const latency = clamp(Math.round(c5.baseline_reflex_latency_ms * 1.15 * (1 + c5.typo_vulnerability_index * 0.5)), 900, 4000);

  const speed = clamp(round2(0.9 + Math.max(0, c3.max_intelligible_wpm - 110) / 100), 0.7, 1.8);
  const wpmCeiling = clamp(c3.max_intelligible_wpm > 0 ? c3.max_intelligible_wpm - 20 : 140, 90, 400);
  const flash = clamp(Math.round(2400 - (bandIndex / BAND_ORDER.length) * 700), 1200, 2500);

  // Sub-level seeds follow demonstrated accuracy, capped so nothing skips ahead
  // of what calibration actually showed.
  const subFromSyntax = Math.max(1, Math.min(3, Math.floor(syntaxIndex / 2) + 1));
  const subFromAccuracy = c5.untimed_accuracy_pct >= 99.5 ? 3 : c5.untimed_accuracy_pct >= 98 ? 2 : 1;
  const vsub = Math.max(subFromSyntax, subFromAccuracy);

  return {
    latency_threshold_ms: latency,
    speed_multiplier: speed,
    wpm_ceiling: wpmCeiling,
    flash_duration_ms: flash,
    phase1_sublevel: {
      P1_VD: vsub,
      P1_VSF: vsub,
      P1_VM: Math.max(1, vsub - 1),
    },
  };
}

/** Section 1.2: the calibration battery per vector, for the client. */
export const CALIBRATION_MANIFEST: Record<CalibrationVectorId, { name: string; passes: ('untimed' | 'timed')[] }> = {
  C1: { name: 'LEXICAL RANGE', passes: ['untimed', 'timed'] },
  C2: { name: 'SYNTAX CEILING', passes: ['untimed', 'timed'] },
  C3: { name: 'AURAL PROCESSING SPEED', passes: ['untimed', 'timed'] },
  C4: { name: 'ARTICULATION BASELINE', passes: ['untimed', 'timed'] },
  C5: { name: 'ORTHOGRAPHIC REFLEX', passes: ['untimed', 'timed'] },
};
