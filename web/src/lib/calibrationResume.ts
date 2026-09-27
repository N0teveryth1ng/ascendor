/** The calibration vectors in the order the wizard runs them. */
export const VECTORS = ['C1', 'C2', 'C3', 'C4', 'C5'] as const;
export type Vector = (typeof VECTORS)[number];

export type CalibrationPassType = 'untimed' | 'timed';

const pair = (vector: string, passType: string) => `${vector}/${passType}`;

export interface ResumeStep {
  stepIndex: number;
  passType: CalibrationPassType;
  /** False when every pass is already on file, so there is nothing left to run. */
  remaining: boolean;
}

/**
 * Where the wizard should open, given the passes already recorded.
 *
 * The wizard previously started at C1 on every load and tracked progress only in
 * page-local state. A candidate who refreshed after two vectors was made to redo
 * them, and because the newest recorded pass per pair is the one that counts,
 * those re-runs silently replaced the passes already on file. The rule is
 * therefore "first pair not yet recorded", in wizard order: each vector's
 * untimed pass before its timed one, and the vectors in sequence.
 */
export function nextCalibrationStep(
  recorded: readonly { vector: string; pass_type: string }[] | undefined,
): ResumeStep {
  const done = new Set((recorded ?? []).map((p) => pair(p.vector, p.pass_type)));
  for (const [i, vector] of VECTORS.entries()) {
    for (const passType of ['untimed', 'timed'] as const) {
      if (!done.has(pair(vector, passType))) {
        return { stepIndex: i, passType, remaining: true };
      }
    }
  }
  return { stepIndex: VECTORS.length - 1, passType: 'timed', remaining: false };
}

/**
 * Distinct passes on file, counting the ones recorded earlier as well as those
 * added in this page load, so a resumed wizard shows true progress instead of
 * restarting its bar at zero.
 */
export function calibrationProgress(
  recorded: readonly { vector: string; pass_type: string }[] | undefined,
  thisLoad: readonly { vector: string; pass_type: string }[] = [],
): { done: number; total: number } {
  const done = new Set<string>();
  for (const p of recorded ?? []) done.add(pair(p.vector, p.pass_type));
  for (const p of thisLoad) done.add(pair(p.vector, p.pass_type));
  return { done: done.size, total: VECTORS.length * 2 };
}
