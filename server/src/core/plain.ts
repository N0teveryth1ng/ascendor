import type { ErrorCategory } from './errorTags.js';
import type { ErrorTagCode } from './types.js';

/**
 * Section 13.2. Screen-facing language only. The raw error_tag and category are
 * still what gets written to the database and what the teacher view shows; this
 * map is what the candidate reads.
 */
export const PLAIN_CATEGORY: Record<ErrorCategory, string> = {
  tense_marker: 'check the verb tense',
  voice_agreement: 'check subject and verb agreement',
  third_person_s: 'watch the ending on verbs like "he/she/it"',
  article_agreement: 'check the article ("a", "an", "the")',
  plural_agreement: 'check singular vs. plural',
  preposition_selection: 'check the preposition',
  homophone_their_there: '"their" (possessive) vs. "there" (place)',
  homophone_there_theyre: '"there" (place) vs. "they\'re" (they are)',
  homophone_your_youre: '"your" (possessive) vs. "you\'re" (you are)',
  homophone_to_too_two: '"to", "too", or "two"',
  homophone_their_theyre: '"their" vs. "they\'re"',
  lexical_selection: 'try a different word',
  past_perfect_construction: 'past perfect construction',
  conditional_construction: 'conditional (if/then) structure',
  relative_clause: 'relative clause structure',
  passive_voice: 'passive voice structure',
  slot_if_condition: 'the "if" half of this pattern',
  slot_then_consequence: 'the "then" half of this pattern',
  slot_var_a: 'the first changing word',
  slot_var_b: 'the second changing word',
  anomaly_detection: 'this sentence is the odd one out',
  sequence_ordering: 'the order of events',
  scene_action_binding: 'who did what',
  scene_object_binding: 'who did it to what',
  scene_enumeration: 'the number or order of things',
  phoneme_substitution: 'a sound in the middle of the word',
  consonant_clusters_str_thr: 'the consonant cluster',
  clarity_deficit: 'spoken clarity',
  spelling_error: 'spelling',
  hesitation_onset: 'hesitation before speaking',
};

export function plainCategory(category: string | null | undefined): string {
  if (!category) return 'this one';
  return PLAIN_CATEGORY[category as ErrorCategory] ?? 'this one';
}

export interface PlainFeedback {
  /** One short line. Never more than one sentence. */
  text: string;
  tone: 'success' | 'error' | 'warning';
}

/**
 * Turns an engine verdict into candidate-facing copy. The engine's own
 * `rendered` string is untouched and still persisted; this is display only.
 */
export function plainFeedback(code: ErrorTagCode, category: string | null, input?: string | null, expected?: string | null): PlainFeedback {
  switch (code) {
    case 'ACCEPTED':
      return { text: 'Correct.', tone: 'success' };
    case 'LATENCY_FAIL':
      return { text: 'Right answer, but a little slow.', tone: 'warning' };
    case 'PATTERN_MISMATCH': {
      const hint = plainCategory(category);
      if (input && expected) {
        return { text: `Not quite — you wrote "${input}", the answer is "${expected}". Check ${hint}.`, tone: 'error' };
      }
      return { text: `Not quite — check ${hint}.`, tone: 'error' };
    }
    case 'TYPO_DETECTED':
      return { text: 'Spelling slip on this one.', tone: 'error' };
    case 'STRUCTURAL_LOCK_TRIGGERED':
      return { text: 'We are spending extra time on this topic — that is normal, keep going.', tone: 'warning' };
    case 'STREAK_TERMINATED':
      return { text: 'Today fell short of your target. Tomorrow is a fresh start.', tone: 'warning' };
    default:
      return { text: 'Check that answer.', tone: 'error' };
  }
}

/** Section 13.2 — rank labels, short form for candidate surfaces. */
export const PLAIN_RANK: Record<string, string> = {
  'RANK 03: DECODER': 'Level 3: Decoder',
  'RANK 02: OPERATOR': 'Level 2: Operator',
  'RANK 01: STRIKER': 'Level 1: Striker',
  'RANK 00: MASTER': 'Level 0: Master',
};

export function plainRank(rank: string): string {
  return PLAIN_RANK[rank] ?? rank;
}

export const PLAIN_RANK_BLURB: Record<string, string> = {
  'RANK 03: DECODER': 'You are learning the core patterns. This is the starting level.',
  'RANK 02: OPERATOR': 'You work accurately under time pressure. Faster material unlocks next.',
  'RANK 01: STRIKER': 'You are accurate and fast. The hardest drills are now open.',
  'RANK 00: MASTER': 'Top level. You are maintaining accuracy at maximum speed.',
};

/** Section 13.2 — module titles, short form for candidate surfaces. */
export const PLAIN_MODULE: Record<string, string> = {
  P1_VD: 'Sentence Accuracy',
  P1_VSF: 'Visual Memory',
  P1_VM: 'Speaking & Clarity',
  P2_RDI: 'Fast Dictation',
  P2_FCM: 'Story Sequencing',
  P3_SSM: 'Word Patterns',
  P3_HVS: 'Fast Listening',
  P4_PC: 'Under Pressure',
  P4_VDS: 'Speaking Under Pressure',
};

export function plainModule(id: string): string {
  return PLAIN_MODULE[id] ?? id;
}

export const PLAIN_BLOCK: Record<string, string> = {
  VOCAL: 'Speaking',
  VECTOR: 'Sentence Accuracy',
  DICTATION: 'Dictation',
  VISUOSPATIAL: 'Visual & Memory',
  LOGGING: 'Wrap-up',
};

/** Section 13.2 — the five calibration steps, in plain language. */
export const CALIBRATION_STEPS: { key: string; title: string; blurb: string }[] = [
  { key: 'C1', title: 'Vocabulary range', blurb: 'We will see which word levels feel comfortable.' },
  { key: 'C2', title: 'Sentence complexity', blurb: 'We will see how complex a sentence you can handle.' },
  { key: 'C3', title: 'Reading speed', blurb: 'We will find the pace that feels right.' },
  { key: 'C4', title: 'Speaking clarity', blurb: 'We will check how clearly your words come through.' },
  { key: 'C5', title: 'Short-term recall', blurb: 'We will see how much you remember moments later.' },
];

export function calibrationStepTitle(key: string): string {
  const step = CALIBRATION_STEPS.find((s) => s.key === key);
  return step ? step.title : key;
}
