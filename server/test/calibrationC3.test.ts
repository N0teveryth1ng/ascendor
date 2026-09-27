/**
 * Calibration vector C3 — the vector that was silently reporting zero.
 *
 * Every stream item was ungradeable. The candidate was told "Type the stream as
 * you hear it" and shown thirteen or fourteen words, then the item was graded by
 * exact string equality against `corrected` — a single word. So every C3 item
 * scored PATTERN_MISMATCH, always, for everyone. `computeC3` requires accuracy
 * at or above the 90% floor to advance the aural seed, so `max_intelligible_wpm`
 * came out as 0 and `accuracy_by_wpm` as all zeroes, and `wpm_ceiling` seeds the
 * whole Phase 1 difficulty ladder. Nothing threw; the number simply read as
 * "cannot process speech at all".
 *
 * The authored data was always right: `anomaly_token` is what was said,
 * `corrected` is what it should have been, and `note` classifies the corruption.
 * The task is anomaly detection and the prompt described dictation.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STREAMS, streamsForBand } from '../src/content/comprehension.js';
import { SYNTAX_TASKS } from '../src/content/syntax.js';
import { SYNTAX_TASKS } from '../src/content/syntax.js';
import { BAND_ORDER } from '../src/content/vocab.js';
import { computeC3 } from '../src/core/calibration.js';
import { MAX_STREAM_WPM, MIN_STREAM_WPM } from '../src/content/index.js';
import { assertPassIntegrity } from '../src/service/calibrationService.js';
import type { RawPass } from '../src/core/calibration.js';

function pass(wpm: number, correct: number, total = 12): RawPass {
  return { vector: 'C3', pass_type: wpm > 250 ? 'timed' : 'untimed', correct, total, mean_latency_ms: 900, wpm } as RawPass;
}

test('every authored stream is self-consistent', () => {
  for (const s of STREAMS) {
    assert.ok(s.anomaly_index >= 0 && s.anomaly_index < s.tokens.length, `${s.id} anomaly_index out of range`);
    assert.equal(s.tokens[s.anomaly_index], s.anomaly_token, `${s.id} anomaly_token does not match the token at that index`);
    assert.notEqual(s.corrected, s.anomaly_token, `${s.id} correction is identical to the corruption`);
  }
});

test('the answer key is a single word, so the task can only be "supply the correction"', () => {
  // This is the invariant the old prompt violated. If the answer were the whole
  // stream, "type the stream" would be correct; because it is one word, that
  // prompt asked for something the grader could never accept.
  for (const s of STREAMS) {
    assert.ok(!/\s/.test(s.corrected), `${s.id} answer is not a single word: "${s.corrected}"`);
    assert.notEqual(s.tokens.join(' '), s.corrected, `${s.id} answer equals the full stream text`);
  }
});

test('the aural seed is derived from real accuracy instead of collapsing to zero', () => {
  // The grading bug made every pass 0%, so this was the only reachable outcome.
  assert.equal(computeC3([pass(200, 0), pass(320, 0)]).max_intelligible_wpm, 0);

  // Clear at 200, fail at 320: the ceiling is the highest rate still understood.
  const partial = computeC3([pass(200, 12), pass(320, 3)]);
  assert.equal(partial.max_intelligible_wpm, 200);
  assert.deepEqual(partial.accuracy_by_wpm, { 200: 100, 320: 25 });

  // Clear at both: the ceiling rises to the faster rate.
  const strong = computeC3([pass(200, 12), pass(320, 12)]);
  assert.equal(strong.max_intelligible_wpm, 320);
  assert.deepEqual(strong.accuracy_by_wpm, { 200: 100, 320: 100 });
});

test('a pass with no wpm contributes nothing rather than a zero-rate measurement', () => {
  // The client used to default a missing wpm to 0, which is silence, not
  // "unknown", and entered accuracy_by_wpm as a real data point.
  const result = computeC3([{ vector: 'C3', pass_type: 'untimed', correct: 12, total: 12, mean_latency_ms: 900 } as RawPass]);
  assert.equal(result.max_intelligible_wpm, 0);
  assert.deepEqual(result.accuracy_by_wpm, {}, 'no wpm means no data point, not a point at 0');
});

test('the two passes must be distinguishable in rate for the contrast to mean anything', () => {
  // Same rate on both passes collapses the measurement to a single speed. The
  // probe ignored pass_type, so this was the production state.
  const identical = computeC3([pass(200, 12), pass(200, 12)]);
  assert.equal(Object.keys(identical.accuracy_by_wpm).length, 1, 'one speed is not a speed curve');

  const distinct = computeC3([pass(200, 12), pass(320, 12)]);
  assert.equal(Object.keys(distinct.accuracy_by_wpm).length, 2);
});

test('the write guard range is the range the generator can actually produce', () => {
  // Asserted against the same constants streamWpm clamps to, so a reported rate
  // can never fall outside what the content pipeline is able to emit.
  assert.equal(MIN_STREAM_WPM, 90);
  assert.equal(MAX_STREAM_WPM, 420);
  for (const s of STREAMS) {
    assert.ok(MIN_STREAM_WPM <= MAX_STREAM_WPM);
  }
});

test('band gating does not starve the stream pool', () => {
  // C3 is drawn through the probe profile, so the pool must contain items at
  // every band the probe can present.
  for (const band of BAND_ORDER) {
    assert.ok(streamsForBand(band, BAND_ORDER).length > 0, `no stream content available at ${band}`);
  }
});

test('a pass whose accuracy contradicts its own item counts is refused', () => {
  // This is the check that makes the write guards load-bearing. Finalisation
  // reads the recorded rows, so a row claiming 100% accuracy while recording
  // 3/12 correct would otherwise seed a ceiling nothing supports.
  const honest = { vector: 'C3' as const, pass_type: 'untimed' as const, correct: 3, total: 12, mean_latency_ms: 900, accuracy_pct: 25 };
  assert.doesNotThrow(() => assertPassIntegrity([honest]));

  assert.throws(
    () => assertPassIntegrity([{ ...honest, accuracy_pct: 100 }]),
    /internally inconsistent/,
    'an accuracy column that disagrees with correct/total must be refused',
  );
  assert.throws(() => assertPassIntegrity([{ ...honest, correct: 30 }]), /claims 30 correct/);
  assert.throws(() => assertPassIntegrity([{ ...honest, total: 0 }]), /invalid item counts/);
  assert.throws(() => assertPassIntegrity([{ ...honest, accuracy_pct: undefined }]), /missing its stored accuracy/);
  assert.throws(() => assertPassIntegrity([{ ...honest, mean_latency_ms: -1 }]), /implausible mean latency/);
});

/**
 * Candidate-facing text must not describe the machinery. Both authored banks
 * were originally written in the engine's own vocabulary, so a candidate was
 * asked to find the wrong word in a sentence about thresholds and locks, and to
 * complete constructions about the APE holding a factor. That leaks how the
 * system works and, worse, makes the task depend on words the candidate has no
 * reason to know. The banks are now neutral everyday language, and this test is
 * what keeps them that way.
 */
const INTERNALS = [
  'ape', 'structural lock', 'phase 1', 'phase 2', 'calibration', 'profile',
  'drill', 'trainer', 'candidate', 'module', 'threshold', 'reflex',
  'latency', 'band', 'escalation', 'lock', 'streak', 'rank', 'rolling window',
  'recalculation', 'recalculate', 'factor', 'trend', 'baseline', 'remediation',
  'pace engine', 'engine', 'anchor', 'bayesian', 'glicko', 'precision index',
  'streak_terminated', 'wpm', 'vector', 'ceiling', 'syntax', 'dictation',
];

function assertNoInternals(text: string, where: string): void {
  for (const term of INTERNALS) {
    // Word-boundary match, so `engineer` does not trip `engine` and `block` does
    // not trip `lock`, but a genuine mention anywhere in the prose does.
    const re = new RegExp(`(^|[^a-z])${term}([^a-z]|$)`, 'i');
    assert.ok(!re.test(text), `${where} exposes the internal term '${term}': ${text}`);
  }
}

test('no stream shows the candidate the internal vocabulary', () => {
  for (const s of STREAMS) {
    // The whole spoken sentence is candidate-facing, and the answer key is shown
    // in the prompt detail, so both are checked.
    assertNoInternals(s.tokens.join(' '), `${s.id} stream`);
    assertNoInternals(s.corrected, `${s.id} correction`);
  }
});

test('no C2 construction shows the candidate the internal vocabulary', () => {
  for (const t of SYNTAX_TASKS) {
    assertNoInternals(t.scaffold, `${t.id} scaffold`);
    for (const o of t.options) assertNoInternals(o, `${t.id} option`);
  }
});

test('no C2 construction names a particular candidate', () => {
  // The bank is drawn per candidate, so a name in the prose is shown to whoever
  // draws that task rather than to the person it was written about.
  for (const t of SYNTAX_TASKS) {
    assert.ok(!/\bbilli\b/i.test(t.scaffold), `${t.id} names a candidate in its prose: ${t.scaffold}`);
  }
});
