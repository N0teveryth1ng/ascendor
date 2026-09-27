/**
 * The calibration wizard must resume where it left off.
 *
 * It used to open at C1 on every load and count progress only in page-local
 * state. That was not a cosmetic problem: the newest recorded pass per pair is
 * the one the profile is derived from, so refreshing after two vectors made the
 * candidate redo those vectors, and the re-runs silently replaced the passes
 * already on file. A candidate could lose good evidence to an accident.
 *
 * The rule under test is "first pair not yet recorded", in wizard order.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  VECTORS,
  calibrationProgress,
  nextCalibrationStep,
} from '../../web/src/lib/calibrationResume.js';

const p = (vector: string, passType: 'untimed' | 'timed') => ({ vector, pass_type: passType });
const ALL: Array<{ vector: string; pass_type: string }> = VECTORS.flatMap((v) => [
  p(v, 'untimed'),
  p(v, 'timed'),
]);

test('a new candidate starts at C1 untimed', () => {
  assert.deepEqual(nextCalibrationStep([]), { stepIndex: 0, passType: 'untimed', remaining: true });
  assert.deepEqual(nextCalibrationStep(undefined), { stepIndex: 0, passType: 'untimed', remaining: true });
});

test('the wizard resumes at the first pair that is not on file', () => {
  // Only C1 done, and only its untimed half: the timed pass comes next, because
  // a vector's untimed pass is its comfortable one and must precede the timed.
  assert.deepEqual(nextCalibrationStep([p('C1', 'untimed')]), {
    stepIndex: 0, passType: 'timed', remaining: true,
  });
  // C1 complete moves to C2 untimed rather than staying on C1.
  assert.deepEqual(nextCalibrationStep([p('C1', 'untimed'), p('C1', 'timed')]), {
    stepIndex: 1, passType: 'untimed', remaining: true,
  });
});

test('this is exactly the shape of the stored evidence, and it resumes at C4', () => {
  // The real production state: C1-C3 and C5 recorded, C4 absent.
  const stored = [
    p('C1', 'untimed'), p('C1', 'timed'),
    p('C2', 'untimed'), p('C2', 'timed'),
    p('C3', 'untimed'), p('C3', 'timed'),
    p('C5', 'untimed'), p('C5', 'timed'),
  ];
  const next = nextCalibrationStep(stored);
  assert.equal(VECTORS[next.stepIndex], 'C4');
  assert.equal(next.passType, 'untimed');

  // And once C4's two passes exist there is nothing left to run, rather than
  // inviting the candidate to sit through all ten passes again.
  const complete = nextCalibrationStep([...stored, p('C4', 'untimed'), p('C4', 'timed')]);
  assert.equal(complete.remaining, false);
});

test('a hole in the middle is not skipped', () => {
  // A missing C3 timed pass must be run even though C4 and C5 are on file,
  // otherwise the profile would be built from a partial C3.
  const holed = ALL.filter((x) => !(x.vector === 'C3' && x.pass_type === 'timed'));
  const next = nextCalibrationStep(holed);
  assert.equal(VECTORS[next.stepIndex], 'C3');
  assert.equal(next.passType, 'timed');
});

test('progress counts passes on file, not just this page load', () => {
  // Resuming must not reset the bar to zero when nothing was run this load.
  const stored = [p('C1', 'untimed'), p('C1', 'timed'), p('C2', 'untimed')];
  assert.deepEqual(calibrationProgress(stored, []), { done: 3, total: 10 });
  // A pass recorded this page load adds to the total rather than replacing it.
  assert.deepEqual(calibrationProgress(stored, [p('C2', 'timed')]), { done: 4, total: 10 });
  assert.deepEqual(calibrationProgress(undefined, []), { done: 0, total: 10 });
  // Duplicates across the two sources are one pass, not two.
  assert.deepEqual(calibrationProgress(stored, [p('C1', 'untimed')]), { done: 3, total: 10 });
  assert.deepEqual(calibrationProgress(ALL, []), { done: 10, total: 10 });
});
