import type { ErrorEvent, ErrorTagCode, Attempt } from './types.js';

/**
 * Section 4.3 — full error tag taxonomy.
 * Every tag category maps to a specific, learnable cause. Nothing is unlabeled.
 */
export const ERROR_CATEGORIES = {
  TENSE_MARKER: 'tense_marker',
  VOICE: 'voice_agreement',
  THIRD_PERSON_S: 'third_person_s',
  ARTICLE: 'article_agreement',
  PLURAL: 'plural_agreement',
  PREPOSITION: 'preposition_selection',
  HOMOPHONE_THEIR_THERE: 'homophone_their_there',
  HOMOPHONE_THERE_THEYRE: 'homophone_there_theyre',
  HOMOPHONE_YOUR_YOURE: 'homophone_your_youre',
  HOMOPHONE_TO_TOO_TWO: 'homophone_to_too_two',
  HOMOPHONE_THEIR_THEYRE: 'homophone_their_theyre',
  LEXICAL: 'lexical_selection',
  PAST_PERFECT: 'past_perfect_construction',
  CONDITIONAL: 'conditional_construction',
  RELATIVE_CLAUSE: 'relative_clause',
  PASSIVE_VOICE: 'passive_voice',
  SLOT_IF: 'slot_if_condition',
  SLOT_THEN: 'slot_then_consequence',
  SLOT_VAR_A: 'slot_var_a',
  SLOT_VAR_B: 'slot_var_b',
  ANOMALY: 'anomaly_detection',
  SEQUENCE_ORDER: 'sequence_ordering',
  SCENE_ACTION: 'scene_action_binding',
  SCENE_OBJECT: 'scene_object_binding',
  SCENE_COUNT: 'scene_enumeration',
  PHONEME_SUBSTITUTION: 'phoneme_substitution',
  CONSONANT_CLUSTER: 'consonant_clusters_str_thr',
  CLARITY: 'clarity_deficit',
  SPELLING: 'spelling_error',
  HESITATION: 'hesitation_onset',
} as const;

export type ErrorCategory = (typeof ERROR_CATEGORIES)[keyof typeof ERROR_CATEGORIES];

export const LEGEND: { code: ErrorTagCode; meaning: string }[] = [
  { code: 'ACCEPTED', meaning: 'Target met within threshold. Stat incremented.' },
  { code: 'LATENCY_FAIL', meaning: 'Correct, but outside current threshold. No accuracy penalty; RL stat penalized only.' },
  { code: 'PATTERN_MISMATCH', meaning: 'Wrong syntax/word choice. Category + expected form shown.' },
  { code: 'TYPO_DETECTED', meaning: 'Orthographic error at speed. Position flagged, not the whole word retyped.' },
  { code: 'STRUCTURAL_LOCK_TRIGGERED', meaning: '4th recurrence of same error type. Remediation scheduled, shown once.' },
  { code: 'STREAK_TERMINATED', meaning: 'Daily threshold missed. Rank progress reduced.' },
];

/**
 * Section 4.2 — the exact output format. One line. One diagnostic tag.
 * No explanation paragraph. No encouragement. No positive framing.
 */
export function renderError(ev: Omit<ErrorEvent, 'rendered'> & { retry_ms?: number }): ErrorEvent {
  let rendered: string;
  switch (ev.code) {
    case 'ACCEPTED':
      rendered = '[ACCEPTED]';
      break;
    case 'LATENCY_FAIL': {
      const d = ev.delta_ms ?? 0;
      rendered = `[LATENCY_FAIL] \u0394${d >= 0 ? '+' : ''}${Math.round(d)}ms`;
      break;
    }
    case 'PATTERN_MISMATCH': {
      const head = `[PATTERN_MISMATCH: ${ev.category ?? 'unclassified'}]`;
      const detail =
        ev.input !== null && ev.expected !== null ? ` input="${ev.input}" expected="${ev.expected}"` : '';
      // Section 4.4: countdown text is omitted on repeat occurrences.
      const tail = ev.retry_ms ? ` \u2192 RETRY IN ${Math.round(ev.retry_ms / 1000)}s` : '';
      rendered = `${head}${detail}${tail}`;
      break;
    }
    case 'TYPO_DETECTED': {
      const pos = ev.position !== null ? ev.position : 0;
      // Abbreviated form: position only, never the whole word retyped.
      rendered = `[TYPO_DETECTED: pos=${pos}]`;
      break;
    }
    case 'STRUCTURAL_LOCK_TRIGGERED':
      rendered = `[STRUCTURAL_LOCK_TRIGGERED: ${ev.category ?? 'unknown'}]`;
      break;
    case 'STREAK_TERMINATED':
      rendered = '[STREAK_TERMINATED]';
      break;
    default: {
      const never: never = ev.code;
      throw new Error(`Untagged error category: ${String(never)}`);
    }
  }
  return { ...ev, rendered };
}

/** Section 4.3: abbreviated repeat form, used after first occurrence in a session. */
const SEEN_IN_SESSION = new Set<string>();

export function beginErrorSession(): void {
  SEEN_IN_SESSION.clear();
}

function markSeen(key: string): boolean {
  if (SEEN_IN_SESSION.has(key)) return false;
  SEEN_IN_SESSION.add(key);
  return true;
}

export function isFirstOccurrence(key: string): boolean {
  return markSeen(key);
}

/* ── Grading ─────────────────────────────────────────────────────────────── */

export interface GradeInput {
  input: string;
  expected: string;
  latency_ms: number;
  threshold_ms: number;
  /** Preferred diagnostic category supplied by the content bank. */
  category: ErrorCategory;
  /** Typo vs. genuine pattern error. */
  mode: 'pattern' | 'typo' | 'precision';
  firstInSession?: boolean;
}

export interface Graded {
  code: ErrorTagCode;
  category: string | null;
  correct: boolean;
  char_position: number | null;
  latency_delta_ms: number | null;
  rendered: string;
}

/**
 * Section 4.2 + 7.2.1: correct-but-slow is LATENCY_FAIL, not a failure.
 * Section 5.2: LATENCY_FAIL never cuts stats; it penalizes RL only.
 */
export function grade(g: GradeInput): Graded {
  const normalizedInput = normalize(g.input);
  const normalizedExpected = normalize(g.expected);
  const isCorrect = normalizedInput === normalizedExpected;
  const delta = g.latency_ms - g.threshold_ms;

  if (!isCorrect) {
    if (g.mode === 'typo') {
      const pos = firstDivergenceIndex(normalizedInput, normalizedExpected);
      const first = g.firstInSession ?? isFirstOccurrence(`TYPO:${g.category}`);
      return {
        code: 'TYPO_DETECTED',
        category: g.category,
        correct: false,
        char_position: pos,
        latency_delta_ms: delta,
        rendered: renderError({
          code: 'TYPO_DETECTED',
          category: g.category,
          input: null,
          expected: null,
          position: pos,
          delta_ms: null,
          retry_ms: first ? 3000 : undefined,
        }).rendered,
      };
    }
    const first = g.firstInSession ?? isFirstOccurrence(`PM:${g.category}`);
    return {
      code: 'PATTERN_MISMATCH',
      category: g.category,
      correct: false,
      char_position: null,
      latency_delta_ms: delta,
      rendered: renderError({
        code: 'PATTERN_MISMATCH',
        category: g.category,
        input: g.input.trim(),
        expected: g.expected.trim(),
        position: null,
        delta_ms: null,
        retry_ms: first ? 3000 : undefined,
      }).rendered,
    };
  }

  if (delta > 0) {
    const first = g.firstInSession ?? isFirstOccurrence(`LF:${g.category}`);
    return {
      code: 'LATENCY_FAIL',
      category: g.category,
      correct: true,
      char_position: null,
      latency_delta_ms: delta,
      rendered: renderError({
        code: 'LATENCY_FAIL',
        category: g.category,
        input: null,
        expected: null,
        position: null,
        delta_ms: delta,
        retry_ms: first ? 3000 : undefined,
      }).rendered,
    };
  }

  return {
    code: 'ACCEPTED',
    category: null,
    correct: true,
    char_position: null,
    latency_delta_ms: delta,
    rendered: renderError({
      code: 'ACCEPTED',
      category: null,
      input: null,
      expected: null,
      position: null,
      delta_ms: null,
    }).rendered,
  };
}

export function normalize(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ');
}

export function firstDivergenceIndex(input: string, expected: string): number {
  const n = Math.max(input.length, expected.length);
  for (let i = 0; i < n; i++) {
    if (input[i] !== expected[i]) return i;
  }
  return Math.min(input.length, expected.length);
}

/**
 * Character-level scoring for the Precision Index (Section 3):
 * correct_chars / total_chars_attempted.
 */
export function scoreChars(input: string, expected: string): { correct: number; total: number } {
  const total = expected.length;
  let correct = 0;
  for (let i = 0; i < total; i++) {
    if (normalizeChar(input[i] ?? '') === normalizeChar(expected[i] ?? '')) correct++;
  }
  return { correct, total };
}

function normalizeChar(c: string): string {
  return c.trim().toLowerCase();
}

export function attemptToErrorEvent(a: Attempt): ErrorEvent {
  return renderError({
    code: a.error_code,
    category: a.error_category,
    input: a.input,
    expected: a.expected,
    position: a.char_position,
    delta_ms: a.latency_delta_ms,
  });
}
