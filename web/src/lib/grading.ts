import type { Attempt, DrillItem, ErrorEvent, ErrorTagCode } from '../types';

/**
 * Client-side grading mirrors the server taxonomy so feedback is instant, but
 * the server remains authoritative: it recomputes every attempt on submit.
 */

const normalize = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[.,!?;:]+$/g, '')
    .replace(/\s+/g, ' ');

export function firstDivergenceIndex(input: string, expected: string): number {
  const a = normalize(input);
  const b = normalize(expected);
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : n;
}

/** A one-word slip inside an otherwise correct utterance is a TYPO, not a wrong word. */
export function isTypo(input: string, expected: string): boolean {
  const a = normalize(input).split(' ');
  const b = normalize(expected).split(' ');
  if (a.length !== b.length) return false;
  const diffs = a.reduce((n, w, i) => n + (w === b[i] ? 0 : 1), 0);
  if (diffs !== 1) return false;
  const i = a.findIndex((w, k) => w !== b[k]);
  if (i < 0) return false;
  const spoken = a[i]!;
  const want = b[i]!;
  // One-character substitution/omission/duplication, not a different word.
  const dist = levenshtein(spoken, want);
  return dist <= 1 && spoken !== want;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const prev = new Array<number>(b.length + 1);
  const cur = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j]! + 1,
        cur[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j]!;
  }
  return prev[b.length]!;
}

export interface GradeResult {
  correct: boolean;
  code: ErrorTagCode;
  category: string | null;
  char_position: number | null;
  counted_chars: number;
  correct_chars: number;
  rendered: string;
  retry_ms?: number;
}

export function gradeAnswer(
  item: DrillItem,
  input: string | null,
  latencyMs: number,
  category?: string,
): GradeResult {
  const threshold = item.threshold_ms;
  const delta = Math.round(latencyMs - threshold);

  if (input !== null && input.trim() !== '') {
    const a = normalize(input);
    const e = normalize(expectedOf(item));
    if (a !== e) {
      const pos = firstDivergenceIndex(a, e);
      if (isTypo(input, expectedOf(item))) {
        return {
          correct: false,
          code: 'TYPO_DETECTED',
          category: category ?? null,
          char_position: pos,
          counted_chars: e.length,
          correct_chars: 0,
          // The full word is never retyped: position only, per Section 4.
          rendered: `[TYPO_DETECTED: pos=${pos}]`,
          retry_ms: 2000,
        };
      }
      return {
        correct: false,
        code: 'PATTERN_MISMATCH',
        category: category ?? null,
        char_position: pos,
        counted_chars: e.length,
        correct_chars: 0,
        rendered: `[PATTERN_MISMATCH${category ? `: ${category}` : ''}] input="${input}" expected="${expectedOf(item)}" → RETRY IN 3s`,
        retry_ms: 3000,
      };
    }
  }

  // Correct content, but too slow for the APE-set threshold. A slow correct
  // answer is NOT a failure.
  if (delta > 0) {
    return {
      correct: true,
      code: 'LATENCY_FAIL',
      category: null,
      char_position: null,
      counted_chars: expectedOf(item).length || 1,
      correct_chars: expectedOf(item).length || 1,
      rendered: `[LATENCY_FAIL] Δ+${delta}ms`,
    };
  }

  return {
    correct: true,
    code: 'ACCEPTED',
    category: null,
    char_position: null,
    counted_chars: expectedOf(item).length || 1,
    correct_chars: expectedOf(item).length || 1,
    rendered: '[ACCEPTED]',
  };
}

function expectedOf(item: DrillItem): string {
  if ('expected' in item && typeof item.expected === 'string') return item.expected;
  if (item.kind === 'recall' || item.kind === 'scene') return '';
  if (item.kind === 'stream' || item.kind === 'aural' || item.kind === 'microtext') return item.text;
  if (item.kind === 'anomaly') return item.corrected;
  if (item.kind === 'vocal' || item.kind === 'burst') return item.text;
  return '';
}

export function toAttempt(
  item: DrillItem,
  grade: GradeResult,
  input: string | null,
  latencyMs: number,
  extra: Partial<Attempt> = {},
): Attempt {
  return {
    item_id: item.item_id,
    item_kind: item.kind,
    input,
    expected: expectedOf(item) || null,
    correct: grade.correct,
    latency_ms: Math.round(latencyMs),
    error_code: grade.correct && grade.code === 'ACCEPTED' ? 'ACCEPTED' : grade.code,
    error_category: grade.category,
    char_position: grade.char_position,
    latency_delta_ms: Math.round(latencyMs - item.threshold_ms),
    counted_chars: grade.counted_chars,
    correct_chars: grade.correct_chars,
    ...extra,
  };
}

export function toErrorEvent(item: DrillItem, grade: GradeResult): ErrorEvent {
  return {
    code: grade.code,
    category: grade.category,
    rendered: grade.rendered,
    item_id: item.item_id,
    char_position: grade.char_position,
    ...(grade.retry_ms ? { retry_ms: grade.retry_ms } : {}),
  };
}
