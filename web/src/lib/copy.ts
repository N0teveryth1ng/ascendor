/**
 * Section 13.2. Every candidate-facing string. Internal tags never reach this
 * file's callers; the engine's own codes stay in the database untouched.
 */
export const CATEGORY_HINT: Record<string, string> = {
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
  past_perfect_construction: 'past perfect structure',
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

export function hint(category: string | null | undefined): string {
  if (!category) return 'this one';
  return CATEGORY_HINT[category] ?? 'this one';
}

export type Tone = 'success' | 'error' | 'warning';

export interface Feedback {
  text: string;
  tone: Tone;
}

/** One line, instant, unambiguous about what to do next. */
export function feedback(
  code: string,
  category: string | null,
  input?: string | null,
  expected?: string | null,
): Feedback {
  switch (code) {
    case 'ACCEPTED':
      return { text: 'Correct.', tone: 'success' };
    case 'LATENCY_FAIL':
      return { text: 'Right answer, but a little slow.', tone: 'warning' };
    case 'PATTERN_MISMATCH': {
      const h = hint(category);
      if (input && expected) {
        return { text: `Not quite — you wrote "${input}", the answer is "${expected}". Check ${h}.`, tone: 'error' };
      }
      return { text: `Not quite — check ${h}.`, tone: 'error' };
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

export const RANK_LABEL: Record<string, string> = {
  'RANK 03: DECODER': 'Level 3: Decoder',
  'RANK 02: OPERATOR': 'Level 2: Operator',
  'RANK 01: STRIKER': 'Level 1: Striker',
  'RANK 00: MASTER': 'Level 0: Master',
};

export const RANK_BLURB: Record<string, string> = {
  'RANK 03: DECODER': 'You are learning the core patterns. This is the starting level.',
  'RANK 02: OPERATOR': 'You work accurately under time pressure. Faster material unlocks next.',
  'RANK 01: STRIKER': 'You are accurate and fast. The hardest drills are now open.',
  'RANK 00: MASTER': 'Top level. You are holding accuracy at maximum speed.',
};

export function rankLabel(rank: string): string {
  return RANK_LABEL[rank] ?? rank;
}

export const MODULE_LABEL: Record<string, string> = {
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

export function moduleLabel(id: string): string {
  return MODULE_LABEL[id] ?? id;
}

/** Plain-English focus line for the end-of-session summary. */
export function focusLine(result: {
  accuracy_pct: number;
  mean_latency_ms: number;
  structural_locks_triggered: string[];
}): string {
  if (result.structural_locks_triggered.length > 0) {
    return 'We are spending a little extra time on one topic this week. That is expected — keep going.';
  }
  if (result.accuracy_pct >= 95) return 'Strong session. Next time the pace will nudge up slightly.';
  if (result.accuracy_pct >= 85) return 'Good session. We will hold the pace here for now.';
  return 'Tough one. We will come back to this topic with more practice.';
}
