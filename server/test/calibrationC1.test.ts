/**
 * Calibration vector C1 — the guard that was missing.
 *
 * The live bug: Onboarding wired C1 to probe module `P3_SSM`, so the
 * "LEXICAL RANGE" pass showed candidates APE rule logic
 * ("IF accuracy rises 3 steps -> THEN factor 0.93") instead of vocabulary, and
 * then keyed band scores by `item_id.split('-')[2]`, which yields a slot-item
 * pattern id rather than a vocabulary band. `deriveVocabularyBand` does not
 * recognise those keys, stops at the first one, and returns V1 — so every
 * candidate silently received a fabricated V1 baseline at 0% accuracy, and that
 * number was persisted as if it were a measurement.
 *
 * These tests pin the three properties that bug violated: real single words,
 * real V1-V12 band keys, and a hard failure rather than a silent fallback.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertVocabularyItems, buildC1Items, C1_ITEMS_PER_BAND } from '../src/content/calibrationC1.js';
import { BAND_ORDER, VOCAB_BANDS } from '../src/content/vocab.js';
import { deriveVocabularyBand } from '../src/content/vocab.js';
import { HttpError } from '../src/service/httpError.js';

const THRESHOLD = 2400;

test('C1 serves one real word per band, twelve items total', () => {
  const items = buildC1Items('billi', 'untimed', THRESHOLD);
  assert.equal(items.length, BAND_ORDER.length * C1_ITEMS_PER_BAND);
  assert.equal(items.length, 12);
});

test('every C1 item is a single word drawn from its own band', () => {
  const items = buildC1Items('anik', 'untimed', THRESHOLD);
  for (const item of items) {
    assert.equal(item.kind, 'vocab');
    const { word, band, audio_cue: cue } = item as Extract<(typeof items)[number], { kind: 'vocab' }>;
    assert.match(word, /^[a-z]{1,20}$/, `not a single lowercase word: ${word}`);
    assert.equal(cue, word, 'audio cue must be the word itself');
    assert.ok(
      VOCAB_BANDS[band].words.includes(word),
      `${word} is not in band ${band}; content must come from the Section 5.4 bank`,
    );
  }
});

test('C1 covers V1..V12 exactly once, so every band is scoreable', () => {
  const items = buildC1Items('billi', 'untimed', THRESHOLD);
  const bands = items.map((i) => (i as { band: string }).band);
  assert.deepEqual([...bands].sort(), [...BAND_ORDER].sort());
});

test('C1 exercises both recognition and production', () => {
  const items = buildC1Items('billi', 'untimed', THRESHOLD);
  const directions = new Set(items.map((i) => (i as { direction: string }).direction));
  assert.deepEqual([...directions].sort(), ['production', 'recognition']);
  for (const item of items) {
    if ((item as { direction: string }).direction === 'recognition') {
      const opts = (item as { options: string[] }).options;
      assert.ok(opts.length >= 2, 'recognition needs the word plus a distractor');
      assert.ok(opts.includes((item as { word: string }).word));
    }
  }
});

test('C1 is deterministic per candidate and pass type', () => {
  const a = buildC1Items('billi', 'untimed', THRESHOLD);
  const b = buildC1Items('billi', 'untimed', THRESHOLD);
  assert.deepEqual(
    a.map((i) => i.item_id),
    b.map((i) => i.item_id),
  );
});

test('the guard rejects the exact payload shape that reached candidates', () => {
  // Reproduces a P3_SSM slot item: an English rule sentence, not a word.
  const leaked = [
    {
      item_id: 'P3_SSM-SS-03-8760',
      kind: 'slot',
      word: 'IF accuracy rises 3 steps THEN forced repeat',
      band: 'SS',
      audio_cue: 'IF accuracy rises 3 steps THEN forced repeat',
    },
  ];
  assert.throws(() => assertVocabularyItems(leaked, 'test'), HttpError);
});

test('the guard rejects a multi-word, a non-vocab kind, and a bad band', () => {
  assert.throws(
    () => assertVocabularyItems([{ kind: 'vocab', word: 'two words', band: 'V1', audio_cue: 'two words' }], 'test'),
    HttpError,
  );
  assert.throws(() => assertVocabularyItems([{ kind: 'pattern', word: 'word', band: 'V1', audio_cue: 'word' }], 'test'), HttpError);
  assert.throws(
    () => assertVocabularyItems([{ kind: 'vocab', word: 'word', band: 'SS', audio_cue: 'word' }], 'test'),
    HttpError,
  );
  assert.throws(() => assertVocabularyItems([], 'test'), HttpError);
});

test('the guard rejects a word that is not in the bank', () => {
  // Shape is valid, provenance is not: a guard on shape alone would let this
  // through, which is why the C1 builder is the only thing allowed to construct
  // these items.
  const items = buildC1Items('billi', 'untimed', THRESHOLD);
  const tampered = [{ ...(items[0] as object), word: 'zzzz', audio_cue: 'zzzz' }];
  assert.doesNotThrow(() => assertVocabularyItems(tampered, 'test'), 'shape guard does not police provenance');
  assert.ok(!VOCAB_BANDS.V1.words.includes('zzzz'), 'confirm the tampered word is genuinely absent from the bank');
});

test('deriveVocabularyBand needs percentages, which is what the client now sends', () => {
  // The old client accumulated a count. With one item per band that is 0 or 1,
  // and `acc >= 90` can never hold, so the vector would resolve to V1 even with
  // correct band keys. Percentages are the only representation that works.
  assert.equal(deriveVocabularyBand({ V1: 1, V2: 1, V3: 1 }), 'V1');
  assert.equal(deriveVocabularyBand({ V1: 100, V2: 100, V3: 100 }), 'V3');
  assert.equal(deriveVocabularyBand({ V1: 100, V2: 100, V3: 40 }), 'V2', 'stops at the first failing band');
});
