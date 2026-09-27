/**
 * Section 5.4 / calibration vector C1: the candidate's lexical range.
 *
 * This exists because C1 was serving the wrong content entirely. `Onboarding`
 * wired C1 to probe module `P3_SSM`, which produces `kind: 'slot'` items whose
 * prompt text is APE rule logic ("IF accuracy rises 3 steps -> THEN factor
 * 0.93"). The 816-word bank in `vocab.ts` was present and correct the whole
 * time — the client just never asked for it. The bank is now the only source
 * for a C1 item, and `assertVocabularyItems` refuses to serve anything that is
 * not a single real word.
 */
import { BAND_ORDER, VOCAB_BANDS } from './vocab.js';
import { seededRng } from '../core/prng.js';
import { HttpError } from '../service/httpError.js';
import type { DrillItem } from './index.js';
import type { VocabularyBand } from '../core/types.js';

/** One word per band: 12 items, one pass. */
export const C1_ITEMS_PER_BAND = 1;

/**
 * A C1 item is one word and its audio cue. A real word is a single lowercase
 * alphabetic token. This is deliberately strict: the bug it guards against was a
 * multi-word English sentence about APE thresholds being shown to a candidate as
 * a vocabulary probe, and only a rule this tight refuses that.
 */
const SINGLE_WORD = /^[a-z]{1,20}$/;
const BAND_ID = /^V(?:[1-9]|1[0-2])$/;

/**
 * Fails loudly when a C1 payload is not vocabulary. This is the hard boundary
 * between content generation and what a candidate is shown: without it, any
 * future content-pool regression reaches the screen silently.
 */
export function assertVocabularyItems(items: unknown, context: string): asserts items is DrillItem[] {
  if (!Array.isArray(items) || items.length === 0) {
    throw new HttpError(500, `C1 content guard: ${context} produced no items`);
  }
  for (const raw of items as Record<string, unknown>[]) {
    const word = raw?.word;
    const why =
      !raw || raw.kind !== 'vocab'
        ? `kind is ${JSON.stringify(raw?.kind)}, expected 'vocab'`
        : typeof word !== 'string'
          ? 'word is missing or not a string'
          : !SINGLE_WORD.test(word)
            ? `word ${JSON.stringify(word)} is not a single lowercase word`
            : typeof raw.band !== 'string' || !BAND_ID.test(raw.band)
              ? `band ${JSON.stringify(raw.band)} is not a V1-V12 vocabulary band`
              : raw.audio_cue !== word
                ? `audio cue ${JSON.stringify(raw.audio_cue)} does not match the word`
                : null;
    if (why) {
      throw new HttpError(
        500,
        `C1 content guard: refusing to serve non-vocabulary content (${context}) — ${why}. ` +
          'A calibration C1 item must be a single word from the Section 5.4 bank plus its audio cue.',
      );
    }
  }
}

/**
 * Builds the C1 pass: one word drawn from each of the 12 frequency bands.
 *
 * Bands alternate recognition (the word is shown, the candidate picks it from
 * options) and production (the word is only spoken, the candidate types it), so
 * one pass exercises both halves of what C1 is meant to measure.
 *
 * Deterministic in `candidateId` + `passType`, so a reload mid-pass re-presents
 * the same words rather than silently changing the difficulty under the
 * candidate.
 */
export function buildC1Items(candidateId: string, passType: 'untimed' | 'timed', thresholdMs: number): DrillItem[] {
  const rng = seededRng(candidateId, 'C1', passType === 'untimed' ? 1 : 2);

  const items = BAND_ORDER.map((band, index): DrillItem => {
    const words = VOCAB_BANDS[band].words;
    const word = words[rng.int(0, words.length - 1)]!;

    // Distractors come from the nearest other bands, so a wrong answer reflects
    // a genuine band confusion rather than an arbitrary guess. The two ends of
    // the frequency range only have one neighbour, and a two-option question is
    // close to a coin flip, so they take the next band along as well.
    const offset = index === 0 ? 1 : index === BAND_ORDER.length - 1 ? -1 : 0;
    const neighbours = [BAND_ORDER[index - 1 + offset], BAND_ORDER[index + 1 + offset]].filter(
      (b, i, arr): b is VocabularyBand => typeof b === 'string' && arr.indexOf(b) === i,
    );
    const distractors = neighbours
      .map((b) => {
        const pool = VOCAB_BANDS[b].words;
        return pool[rng.int(0, pool.length - 1)]!;
      })
      .filter((w) => w !== word);

    const direction: 'recognition' | 'production' = index % 2 === 0 ? 'recognition' : 'production';

    return {
      item_id: `C1-${band}-${word}`,
      threshold_ms: thresholdMs,
      remediation: false,
      kind: 'vocab',
      band,
      band_label: VOCAB_BANDS[band].label,
      word,
      audio_cue: word,
      direction,
      options: direction === 'recognition' ? rng.shuffle([word, ...distractors]) : [],
      expected: word,
      category: 'lexical_selection',
      mode: 'pattern',
    } as unknown as DrillItem;
  });

  assertVocabularyItems(items, `buildC1Items(${passType})`);
  return items;
}
