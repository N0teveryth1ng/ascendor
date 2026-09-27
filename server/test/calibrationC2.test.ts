/**
 * Calibration vector C2 — the vector that was silently reporting the floor.
 *
 * The probe pointed at P1_VD, which serves two-option word-choice pairs, so the
 * "SYNTAX CEILING" pass never showed a construction. Onboarding had no C2 branch
 * at all, so `level_accuracy` was never sent and `deriveSyntaxCeiling([])`
 * returned S1 for everyone: a candidate who scored 8/8 was recorded with the
 * lowest possible syntax ceiling. The 48 authored tasks were present and unused,
 * and `kind: 'syntax'` was declared in the item union but never constructed.
 *
 * These tests pin the properties the bug violated: real constructions, real S1-S8
 * levels, a ceiling that actually responds to performance, and a guard that fires
 * on content which is not a construction.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertSyntaxItems, buildC2Items, C2_ITEMS_PER_LEVEL } from '../src/content/calibrationC2.js';
import { SYNTAX_LEVELS, SYNTAX_TASKS, deriveSyntaxCeiling } from '../src/content/syntax.js';
import { computeC2 } from '../src/core/calibration.js';
import { HttpError } from '../src/service/httpError.js';

const THRESHOLD = 2400;

function ceilingOf(levelAccuracy: Record<string, number> | undefined, correct: number): string {
  return computeC2([
    {
      vector: 'C2',
      pass_type: 'untimed',
      correct,
      total: 8,
      mean_latency_ms: 900,
      level_accuracy: levelAccuracy,
    } as never,
  ]).syntax_ceiling;
}

test('C2 serves one authored construction per level, eight items total', () => {
  const items = buildC2Items('billi', THRESHOLD);
  assert.equal(items.length, SYNTAX_LEVELS.length * C2_ITEMS_PER_LEVEL);
  assert.equal(items.length, 8);
});

test('C2 covers S1..S8 exactly once, so every level is scoreable', () => {
  const items = buildC2Items('billi', THRESHOLD);
  const levels = items.map((i) => (i as { level: string }).level);
  assert.deepEqual(levels, [...SYNTAX_LEVELS]);
});

test('every C2 item is a real construction drawn from the authored bank', () => {
  for (const candidate of ['billi', 'anik']) {
    for (const item of buildC2Items(candidate, THRESHOLD)) {
      const it = item as Extract<(typeof item), { kind: 'syntax' }>;
      assert.equal(it.kind, 'syntax');
      assert.ok(it.scaffold.includes('___'), `scaffold has no gap: ${it.scaffold}`);
      assert.ok(it.options.length >= 2, `construction needs options: ${it.scaffold}`);
      assert.ok(it.options.includes(it.expected), `answer not among options: ${it.scaffold}`);
      const authored = SYNTAX_TASKS.some((t) => t.id === it.item_id.replace(/^C2-/, ''));
      assert.ok(authored, `${it.item_id} is not an authored task`);
    }
  }
});

test('the authored bank is itself well formed, which the guard depends on', () => {
  // S5-05 shipped with no gap at all, so it was a finished sentence whose three
  // options could not be applied. Nothing caught it because nothing validated
  // the bank.
  for (const task of SYNTAX_TASKS) {
    assert.ok(task.scaffold.includes('___'), `${task.id} has no grammatical gap: ${task.scaffold}`);
    assert.ok(task.options.length >= 2, `${task.id} has too few options`);
    assert.ok(task.options.includes(task.expected), `${task.id} answer is not an option`);
  }
});

test('C2 is deterministic per candidate', () => {
  const a = buildC2Items('billi', THRESHOLD);
  const b = buildC2Items('billi', THRESHOLD);
  assert.deepEqual(
    a.map((i) => i.item_id),
    b.map((i) => i.item_id),
  );
});

test('the guard rejects content that is not a construction', () => {
  // The word-choice pair the probe used to serve.
  const pattern = [
    { kind: 'pattern', level: 'S1', scaffold: '___ accuracy declined?', options: ['whose', "who's"], expected: 'whose' },
  ];
  assert.throws(() => assertSyntaxItems(pattern, 'test'), HttpError);

  // A finished sentence with options but no gap: exactly the S5-05 defect.
  assert.throws(
    () =>
      assertSyntaxItems(
        [{ kind: 'syntax', level: 'S1', scaffold: 'The engine recalculated it.', options: ['a', 'b'], expected: 'a' }],
        'test',
      ),
    HttpError,
  );

  // An answer that is not offered.
  assert.throws(
    () =>
      assertSyntaxItems(
        [{ kind: 'syntax', level: 'S1', scaffold: 'The engine ___ it.', options: ['a', 'b'], expected: 'c' }],
        'test',
      ),
    HttpError,
  );

  // A level outside S1-S8.
  assert.throws(
    () =>
      assertSyntaxItems(
        [{ kind: 'syntax', level: 'S9', scaffold: 'The engine ___ it.', options: ['a', 'b'], expected: 'a' }],
        'test',
      ),
    HttpError,
  );

  assert.throws(() => assertSyntaxItems([], 'test'), HttpError);
});

test('the ceiling responds to performance instead of reporting the floor', () => {
  const all = Object.fromEntries(SYNTAX_LEVELS.map((l) => [l, 100]));
  assert.equal(ceilingOf(all, 8), 'S8', 'clearing every level should reach S8');

  const failAt4 = { S1: 100, S2: 100, S3: 100, S4: 0, S5: 100, S6: 100, S7: 100, S8: 100 };
  assert.equal(ceilingOf(failAt4, 7), 'S3', 'must stop at the first failure, not credit S5-S8');

  const failAt1 = { S1: 0, S2: 100, S3: 100, S4: 100, S5: 100, S6: 100, S7: 100, S8: 100 };
  assert.equal(ceilingOf(failAt1, 7), 'S1');

  const failAt7 = { S1: 100, S2: 100, S3: 100, S4: 100, S5: 100, S6: 100, S7: 0, S8: 0 };
  assert.equal(ceilingOf(failAt7, 6), 'S6');
});

test('the old production behaviour is reproduced and is distinguishable', () => {
  // No level_accuracy: 8/8 and still the floor. This is what every candidate
  // actually got before the fix, and the reason C2 could not be trusted.
  assert.equal(ceilingOf(undefined, 8), 'S1');
  assert.equal(deriveSyntaxCeiling([]), 'S1');
  assert.notEqual(ceilingOf(undefined, 8), ceilingOf(Object.fromEntries(SYNTAX_LEVELS.map((l) => [l, 100])), 8));
});

test('a per-level count is not a percentage, and the ceiling must not accept it', () => {
  // The C1 lesson: a count of 1 can never clear a >= 90 gate, so counting
  // silently pins every level at the floor. Percentages are the only form that
  // works, which is why the write boundary restricts values to what a
  // one-item-per-level pass can produce.
  assert.equal(C2_ITEMS_PER_LEVEL, 1);
  const counts = Object.fromEntries(SYNTAX_LEVELS.map((l) => [l, 1]));
  assert.equal(ceilingOf(counts, 8), 'S1', 'a perfect run reported as counts still reads as the floor');
});
