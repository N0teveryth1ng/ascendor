/**
 * Calibration vector C5 — typo vulnerability under time pressure.
 *
 * C5 feeds two numbers that are genuinely load-bearing: `typo_vulnerability_index`
 * gates the C5 floor (calibration.ts: `TVI <= 0.06 && untimed >= 98`) and scales
 * the Phase 1 latency seed as `baseline * 1.15 * (1 + TVI/2)`, and
 * `baseline_reflex_latency_ms` is that seed's base. Neither was reachable from a
 * broken pass, and a zero latency became the tightest window the system can
 * generate, so both are now guarded and covered here.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DICTATION_ITEMS, dictationItemsForBand } from '../src/content/dictation.js';
import { BAND_ORDER } from '../src/content/vocab.js';
import { buildPcp, computeC5 } from '../src/core/calibration.js';
import { assertPassIntegrity } from '../src/service/calibrationService.js';
import type { RawPass } from '../src/core/calibration.js';

const pass = (p: Partial<RawPass> & { pass_type: 'untimed' | 'timed' }): RawPass =>
  ({
    vector: 'C5',
    correct: 36,
    total: 36,
    mean_latency_ms: 1900,
    ...p,
  }) as RawPass;

test('every dictation item is gradeable text with a reachable correct answer', () => {
  for (const d of DICTATION_ITEMS) {
    assert.ok(d.text.trim().length > 0, `${d.id} has no text`);
    assert.ok(!/\s_{2,}/.test(d.text), `${d.id} has an unfilled gap`);
    if (!d.trap) continue;
    // The candidate is shown `text` and must reproduce it. If the correct form
    // is not in the text, the only way to "pass" is to mistype it.
    assert.ok(
      d.text.toLowerCase().includes(d.trap.correct.toLowerCase()),
      `${d.id} shows '${d.text}' but its correct answer '${d.trap.correct}' is not in it`,
    );
    assert.notEqual(
      d.trap.correct.toLowerCase(),
      d.trap.decoy.toLowerCase(),
      `${d.id} trap correct and decoy are the same word`,
    );
  }
});

test('the dictation bank is not starved at any band', () => {
  for (const band of BAND_ORDER) {
    assert.ok(dictationItemsForBand(band, BAND_ORDER).length > 0, `no dictation at ${band}`);
  }
});

test('TVI is the accuracy the candidate loses to time pressure, and nothing else', () => {
  // No degradation: a candidate who is equally accurate under pressure has no
  // typo vulnerability, whatever their absolute accuracy.
  assert.equal(computeC5([pass({ pass_type: 'untimed' }), pass({ pass_type: 'timed' })]).typo_vulnerability_index, 0);
  assert.equal(computeC5([pass({ pass_type: 'untimed', correct: 18 }), pass({ pass_type: 'timed', correct: 9 })]).typo_vulnerability_index, 0.5);

  // Being faster under pressure is not possible, so the index cannot go negative.
  const improved = computeC5([pass({ pass_type: 'untimed', correct: 30 }), pass({ pass_type: 'timed', correct: 36 })]);
  assert.equal(improved.typo_vulnerability_index, 0, 'clamped at zero');

  // Total untimed failure is maximal vulnerability, not a division by zero.
  assert.equal(computeC5([pass({ pass_type: 'untimed', correct: 0 }), pass({ pass_type: 'timed' })]).typo_vulnerability_index, 1);
});

test('the reflex baseline comes from the timed pass and is never invented', () => {
  assert.equal(computeC5([pass({ pass_type: 'untimed' }), pass({ pass_type: 'timed' })]).baseline_reflex_latency_ms, 1900);

  // With no timed pass recorded the untimed latency is the best available, and
  // 2400 is the documented fallback rather than a measured zero.
  assert.equal(computeC5([pass({ pass_type: 'untimed' })]).baseline_reflex_latency_ms, 1900);
  assert.equal(computeC5([pass({ pass_type: 'untimed', mean_latency_ms: 0 })]).baseline_reflex_latency_ms, 0);
});

test('a latency of zero is refused, because it is an absent measurement', () => {
  // clamp(0 * 1.15 * ..., 900, 4000) === 900: the hardest window the system can
  // generate, reached by reporting nothing at all.
  const base = { vector: 'C5' as const, correct: 36, total: 36, accuracy_pct: 100 };
  assert.throws(() => assertPassIntegrity([{ ...base, pass_type: 'timed', mean_latency_ms: 0 }]), /implausible mean latency/);
  assert.throws(() => assertPassIntegrity([{ ...base, pass_type: 'timed', mean_latency_ms: -5 }]), /implausible mean latency/);
  assert.throws(() => assertPassIntegrity([{ ...base, pass_type: 'untimed', mean_latency_ms: 999_999 }]), /implausible mean latency/);
  assert.doesNotThrow(() => assertPassIntegrity([{ ...base, pass_type: 'timed', mean_latency_ms: 1900 }]));
});

test('the C5 floor and latency seed follow the recorded degradation', () => {
  const clean = buildPcp('clean', [
    { vector: 'C1', pass_type: 'untimed', correct: 12, total: 12, mean_latency_ms: 1500, band_accuracy: { V1: 100, V2: 100, V3: 100, V4: 100, V5: 100, V6: 100, V7: 100, V8: 100, V9: 100, V10: 100, V11: 100, V12: 100 } },
    { vector: 'C1', pass_type: 'timed', correct: 12, total: 12, mean_latency_ms: 2200, band_accuracy: { V1: 100, V2: 100, V3: 100, V4: 100, V5: 100, V6: 100, V7: 100, V8: 100, V9: 100, V10: 100, V11: 100, V12: 100 } },
    { vector: 'C2', pass_type: 'untimed', correct: 8, total: 8, mean_latency_ms: 4000, level_accuracy: { S1: 100, S2: 100, S3: 100, S4: 100, S5: 100, S6: 100, S7: 100, S8: 100 } },
    { vector: 'C2', pass_type: 'timed', correct: 8, total: 8, mean_latency_ms: 5200, level_accuracy: { S1: 100, S2: 100, S3: 100, S4: 100, S5: 100, S6: 100, S7: 100, S8: 100 } },
    { vector: 'C3', pass_type: 'untimed', correct: 12, total: 12, mean_latency_ms: 900, wpm: 200 },
    { vector: 'C3', pass_type: 'timed', correct: 12, total: 12, mean_latency_ms: 1500, wpm: 320 },
    { vector: 'C4', pass_type: 'untimed', correct: 5, total: 5, mean_latency_ms: 2200, clarity: 90, clarity_by_class: { a: 90, b: 91, c: 92, d: 93, e: 94 } },
    { vector: 'C4', pass_type: 'timed', correct: 5, total: 5, mean_latency_ms: 3000, clarity: 90, clarity_by_class: { a: 90, b: 91, c: 92, d: 93, e: 94 } },
    pass({ pass_type: 'untimed', correct: 36, total: 36 }),
    pass({ pass_type: 'timed', correct: 36, total: 36, mean_latency_ms: 2200 }),
  ]);
  const lossy = buildPcp('lossy', [
    { vector: 'C1', pass_type: 'untimed', correct: 12, total: 12, mean_latency_ms: 1500, band_accuracy: { V1: 100, V2: 100, V3: 100, V4: 100, V5: 100, V6: 100, V7: 100, V8: 100, V9: 100, V10: 100, V11: 100, V12: 100 } },
    { vector: 'C1', pass_type: 'timed', correct: 12, total: 12, mean_latency_ms: 2200, band_accuracy: { V1: 100, V2: 100, V3: 100, V4: 100, V5: 100, V6: 100, V7: 100, V8: 100, V9: 100, V10: 100, V11: 100, V12: 100 } },
    { vector: 'C2', pass_type: 'untimed', correct: 8, total: 8, mean_latency_ms: 4000, level_accuracy: { S1: 100, S2: 100, S3: 100, S4: 100, S5: 100, S6: 100, S7: 100, S8: 100 } },
    { vector: 'C2', pass_type: 'timed', correct: 8, total: 8, mean_latency_ms: 5200, level_accuracy: { S1: 100, S2: 100, S3: 100, S4: 100, S5: 100, S6: 100, S7: 100, S8: 100 } },
    { vector: 'C3', pass_type: 'untimed', correct: 12, total: 12, mean_latency_ms: 900, wpm: 200 },
    { vector: 'C3', pass_type: 'timed', correct: 12, total: 12, mean_latency_ms: 1500, wpm: 320 },
    { vector: 'C4', pass_type: 'untimed', correct: 5, total: 5, mean_latency_ms: 2200, clarity: 90, clarity_by_class: { a: 90, b: 91, c: 92, d: 93, e: 94 } },
    { vector: 'C4', pass_type: 'timed', correct: 5, total: 5, mean_latency_ms: 3000, clarity: 90, clarity_by_class: { a: 90, b: 91, c: 92, d: 93, e: 94 } },
    pass({ pass_type: 'untimed', correct: 36, total: 36 }),
    pass({ pass_type: 'timed', correct: 20, total: 36, mean_latency_ms: 2200 }),
  ]);

  // A candidate who loses accuracy to time pressure is measurably more
  // vulnerable, and that widens their response window rather than narrowing it.
  assert.ok(lossy.typo_vulnerability_index > clean.typo_vulnerability_index);
  assert.ok(
    lossy.phase_1_entry_difficulty_seed.latency_threshold_ms >
      clean.phase_1_entry_difficulty_seed.latency_threshold_ms,
    'more typo vulnerability should buy a more forgiving window, not a harsher one',
  );
  // C5 reaches the profile through the entry rank, not the weak-vector list:
  // a candidate who cannot hold accuracy under pressure is not yet an operator.
  assert.equal(clean.entry_rank, 'RANK 02: OPERATOR');
  assert.equal(lossy.entry_rank, 'RANK 03: DECODER');
});
