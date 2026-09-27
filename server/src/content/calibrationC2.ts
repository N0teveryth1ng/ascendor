/**
 * Section 5.5 / calibration vector C2: the candidate's syntax ceiling.
 *
 * C2 was the same failure as C1, one level less visible. The probe pointed at
 * P1_VD, which serves two-option word-choice pairs ("whose / who's"), so the
 * "SYNTAX CEILING" pass never presented a construction at all. And Onboarding
 * had no C2 branch, so `level_accuracy` was never sent: `deriveSyntaxCeiling([])`
 * returns S1, the floor, for every candidate regardless of performance. A
 * candidate scoring 67% was recorded with a syntax ceiling of S1 — the lowest
 * possible level — and nothing complained.
 *
 * The 48 authored tasks in `syntax.ts`, six per level across S1-S8, were present
 * and well-formed the whole time. `kind: 'syntax'` was declared in the item
 * union but never constructed anywhere. These items are built from that bank,
 * and `assertSyntaxItems` refuses to serve a payload that is not one of them.
 */
import { SYNTAX_LEVELS, SYNTAX_TASKS, type SyntaxTask } from './syntax.js';
import { seededRng } from '../core/prng.js';
import { HttpError } from '../service/httpError.js';
import type { DrillItem } from './index.js';

/**
 * One task per level. `deriveSyntaxCeiling` gates each level at >= 90% and stops
 * at the first failure, which is the "first structural failure" semantic the
 * battery declares. More items per level would make that gate MORE brittle, not
 * less: at three items a single miss yields 67%, still below 90, so a level the
 * candidate nearly cleared would still read as a failure.
 */
export const C2_ITEMS_PER_LEVEL = 1;

const LEVEL_ID = /^S(?:[1-8])$/;

/**
 * Fails loudly when a C2 payload is not a real construction. Guards the same
 * boundary as `assertVocabularyItems`: a C2 item must be a scaffold with a
 * grammatical gap, real options, and an answer that is one of them.
 */
export function assertSyntaxItems(items: unknown, context: string): asserts items is DrillItem[] {
  if (!Array.isArray(items) || items.length === 0) {
    throw new HttpError(500, `C2 content guard: ${context} produced no items`);
  }
  for (const raw of items as Record<string, unknown>[]) {
    const options = raw?.options;
    const why =
      !raw || raw.kind !== 'syntax'
        ? `kind is ${JSON.stringify(raw?.kind)}, expected 'syntax'`
        : typeof raw.level !== 'string' || !LEVEL_ID.test(raw.level)
          ? `level ${JSON.stringify(raw.level)} is not an S1-S8 syntax level`
          : typeof raw.scaffold !== 'string' || !raw.scaffold.includes('___')
            ? `scaffold ${JSON.stringify(raw.scaffold)} has no grammatical gap to fill`
            : !Array.isArray(options) || options.length < 2
              ? 'a construction needs at least two options'
              : typeof raw.expected !== 'string' || !options.includes(raw.expected)
                ? `expected ${JSON.stringify(raw.expected)} is not one of the options`
                : null;
    if (why) {
      throw new HttpError(
        500,
        `C2 content guard: refusing to serve non-syntax content (${context}) — ${why}. ` +
          'A calibration C2 item must be an authored construction from the Section 5.5 task bank.',
      );
    }
  }
}

function toItem(task: SyntaxTask, thresholdMs: number): DrillItem {
  return {
    // The task id already carries its level, so prefixing the level again would
    // produce C2-S1-S1-06.
    item_id: `C2-${task.id}`,
    kind: 'syntax',
    threshold_ms: thresholdMs,
    remediation: false,
    level: task.level,
    construction: task.construction,
    scaffold: task.scaffold,
    options: task.options,
    expected: task.expected,
    category: task.category,
    mode: 'pattern',
  } as DrillItem;
}

/**
 * Builds the C2 pass: one authored construction per level, S1 through S8.
 *
 * Same content in both passes — the timed pass applies pressure through the
 * probe profile, not by swapping the questions, so the two passes remain
 * comparable the way the engine's untimed/timed contrast requires.
 *
 * Deterministic in `candidateId`, so a reload mid-pass does not change the
 * questions under the candidate.
 */
export function buildC2Items(candidateId: string, thresholdMs: number): DrillItem[] {
  const rng = seededRng(candidateId, 'C2', 1);

  const items = SYNTAX_LEVELS.map((level): DrillItem => {
    const pool = SYNTAX_TASKS.filter((t) => t.level === level);
    if (pool.length === 0) {
      throw new HttpError(500, `C2 content guard: no authored task for level ${level}`);
    }
    // Shuffle first, then take, so a single item per level still varies by
    // candidate while staying reproducible.
    return toItem(rng.shuffle(pool)[0]!, thresholdMs);
  });

  assertSyntaxItems(items, `buildC2Items(${candidateId})`);
  return items;
}
