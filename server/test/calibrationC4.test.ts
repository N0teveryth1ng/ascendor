/**
 * Calibration vector C4 — vocal clarity per phoneme class.
 *
 * C4 is the one vector whose data comes from the candidate's microphone rather
 * than from what they typed, so its integrity problem was different: the client
 * sent an empty map, `computeC4` treated that as "nothing to flag", and the
 * vector produced a clarity baseline of zero without ever saying so. A silent
 * candidate and a candidate with no microphone were the same profile.
 *
 * It is also the one vector whose measurement was quietly wrong rather than
 * missing. `MicCapture.peak()` was a running maximum for the whole pass, and the
 * per-item snapshot therefore carried the loudest moment of the session into
 * every later item: one confident burst set the clarity score for every phoneme
 * class recorded after it. The meter now has a reset, and Onboarding starts a
 * fresh window per recording.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BURST_GROUPS, DEFAULT_BURST_ORDER } from '../src/content/vocal.js';
import { buildPcp, computeC4, VOCAL_WEAK_CLASS_RATIO } from '../src/core/calibration.js';
import { assertPassIntegrity } from '../src/service/calibrationService.js';
import type { RawPass } from '../src/core/calibration.js';

const pass = (o: Partial<RawPass> & { pass_type: 'untimed' | 'timed' }): RawPass =>
  ({ vector: 'C4', correct: 5, total: 5, mean_latency_ms: 2200, ...o }) as RawPass;

const VALID = { str_cluster: 58, th_digraph: 63, voiceless_stops: 88, voiced_stops: 82, laterals: 79 };

test('every C4 phoneme class the client can report is a real class', () => {
  for (const cls of Object.keys(VALID)) {
    assert.ok(cls in BURST_GROUPS, `'${cls}' is not a burst group the engine can serve`);
  }
  for (const cls of DEFAULT_BURST_ORDER) {
    assert.ok(cls in BURST_GROUPS, `default burst order names an unknown class '${cls}'`);
  }
});

test('an empty or missing clarity map cannot seed a zero baseline', () => {
  // The failure this guards: a vector with no measured clarity produced no flags
  // and a baseline of 0, which is what a candidate who said nothing would score.
  assert.equal(computeC4([pass({ pass_type: 'untimed', clarity_by_class: {} })]).baseline_vocal_clarity, 0);
  assert.deepEqual(computeC4([pass({ pass_type: 'untimed', clarity_by_class: {} })]).flagged_weak_vectors, []);
  assert.equal(computeC4([pass({ pass_type: 'untimed' })]).baseline_vocal_clarity, 0);
});

test('a class is flagged only when it is weak against the candidate\'s own range', () => {
  // Scale-invariant: the same shape scores the same at any overall loudness, so
  // a quiet microphone does not manufacture weak phoneme classes.
  const base = { str_cluster: 60, th_digraph: 60, voiceless_stops: 60, voiced_stops: 60 };
  const quiet = computeC4([pass({ pass_type: 'untimed', clarity: 60, clarity_by_class: base })]);
  const loud = computeC4([pass({ pass_type: 'untimed', clarity: 100, clarity_by_class: base })]);
  assert.deepEqual(quiet.flagged_weak_vectors, [], 'a flat profile flags nothing however quiet');
  assert.deepEqual(loud.flagged_weak_vectors, [], 'a flat profile flags nothing however loud');

  // One class meaningfully below the rest is flagged, and only that class.
  const uneven = computeC4([
    pass({ pass_type: 'untimed', clarity: 70, clarity_by_class: { ...base, str_cluster: 30 } }),
  ]);
  assert.ok(uneven.flagged_weak_vectors.includes('consonant_clusters_str_thr'));
  assert.equal(uneven.flagged_weak_vectors.length, 1);

  // Just inside the ratio is not flagged: the threshold is not a tripwire.
  const marginal = computeC4([
    pass({ pass_type: 'untimed', clarity_by_class: { ...base, str_cluster: Math.round(60 * VOCAL_WEAK_CLASS_RATIO) + 1 } }),
  ]);
  assert.deepEqual(marginal.flagged_weak_vectors, []);
});

test('the timed pass is the one that describes clarity, matching the reflection', () => {
  const timed = computeC4([pass({ pass_type: 'untimed', clarity: 90, clarity_by_class: VALID }), pass({ pass_type: 'timed', clarity: 71.2, clarity_by_class: { str_cluster: 40, th_digraph: 45, voiceless_stops: 88, voiced_stops: 84, laterals: 80 } })]);
  assert.equal(timed.baseline_vocal_clarity, 71.2);
  assert.ok(timed.flagged_weak_vectors.includes('consonant_clusters_str_thr'));
});

test('clarity feeds the entry seed, so a silent vector would freeze difficulty', () => {
  const others = (clarityByClass: Record<string, number> | undefined): RawPass[] => [
    { vector: 'C1', pass_type: 'untimed', correct: 12, total: 12, mean_latency_ms: 1500, band_accuracy: { V1: 100, V2: 100, V3: 100, V4: 100, V5: 100, V6: 100, V7: 100, V8: 100, V9: 100, V10: 100, V11: 100, V12: 100 } },
    { vector: 'C1', pass_type: 'timed', correct: 12, total: 12, mean_latency_ms: 2200, band_accuracy: { V1: 100, V2: 100, V3: 100, V4: 100, V5: 100, V6: 100, V7: 100, V8: 100, V9: 100, V10: 100, V11: 100, V12: 100 } },
    { vector: 'C2', pass_type: 'untimed', correct: 8, total: 8, mean_latency_ms: 4000, level_accuracy: { S1: 100, S2: 100, S3: 100, S4: 100, S5: 100, S6: 100, S7: 100, S8: 100 } },
    { vector: 'C2', pass_type: 'timed', correct: 8, total: 8, mean_latency_ms: 5200, level_accuracy: { S1: 100, S2: 100, S3: 100, S4: 100, S5: 100, S6: 100, S7: 100, S8: 100 } },
    { vector: 'C3', pass_type: 'untimed', correct: 12, total: 12, mean_latency_ms: 900, wpm: 200 },
    { vector: 'C3', pass_type: 'timed', correct: 12, total: 12, mean_latency_ms: 1400, wpm: 320 },
    { vector: 'C5', pass_type: 'untimed', correct: 36, total: 36, mean_latency_ms: 2100 },
    { vector: 'C5', pass_type: 'timed', correct: 36, total: 36, mean_latency_ms: 2200 },
    pass({ pass_type: 'untimed', clarity: 50, clarity_by_class: VALID }),
    pass({ pass_type: 'timed', clarity: 50, clarity_by_class: VALID, ...(clarityByClass ? { clarity_by_class: clarityByClass } : {}) }),
  ];

  const measured = buildPcp('measured', others(undefined));
  assert.equal(measured.baseline_vocal_clarity, 50);

  // A clarity of zero must not be reachable as a legitimate stored value. The
  // per-class map is the primary requirement, so it is what a C4 pass without
  // measured clarity is refused for.
  const base = { vector: 'C4' as const, correct: 5, total: 5, mean_latency_ms: 2200, accuracy_pct: 100 };
  assert.throws(
    () => assertPassIntegrity([{ ...base, pass_type: 'timed', clarity: 0 } as never]),
    /requires clarity_by_class/,
  );
  assert.throws(
    () => assertPassIntegrity([{ ...base, pass_type: 'timed', clarity_by_class: { str_cluster: 0 } } as never]),
    /no audio/,
  );
  assert.throws(
    () => assertPassIntegrity([{ ...base, pass_type: 'timed', clarity_by_class: {} } as never]),
    /empty clarity_by_class/,
  );
  assert.throws(
    () => assertPassIntegrity([{ ...base, pass_type: 'timed', clarity_by_class: { not_a_class: 50 } } as never]),
    /unknown phoneme class/,
  );
  assert.throws(
    () => assertPassIntegrity([{ ...base, pass_type: 'timed', clarity_by_class: { str_cluster: 140 } } as never]),
    /between 0 and 100/,
  );
});
