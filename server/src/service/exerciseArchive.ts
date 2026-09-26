import { getDb } from '../db/index.js';
import { MODULES } from '../core/modules.js';
import type { Attempt, ErrorTagCode } from '../core/types.js';

/**
 * Section 13.4. The engine decides correctness, threshold and error tag; this
 * module only records what was shown, what was answered, and which capability
 * the answer fed. Nothing here can change a score.
 */
export interface HiddenMetricDelta {
  /** Metrics this attempt contributed to. */
  metrics: string[];
  /** Per-metric contribution, in the metric's own units. */
  contribution: Record<string, number>;
  /** Why those metrics, for the teacher view. */
  basis: string;
}

export interface ExerciseAttemptInput {
  user_id: string;
  module_id: string;
  exercise_id: string;
  question_shown: string;
  answer_given: string | null;
  correct_answer: string | null;
  is_correct: boolean;
  response_time_ms: number;
  error_tag: string | null;
  hidden_metrics_delta: HiddenMetricDelta;
  session_id: string | null;
  position: number | null;
  created_at: string;
}

export function recordExerciseAttempts(rows: ExerciseAttemptInput[]): number {
  if (rows.length === 0) return 0;
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO exercise_attempts
       (user_id, module_id, exercise_id, question_shown, answer_given, correct_answer,
        is_correct, response_time_ms, error_tag, hidden_metrics_delta, session_id, position, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const r of rows) {
    stmt.run(
      r.user_id,
      r.module_id,
      r.exercise_id,
      r.question_shown,
      r.answer_given,
      r.correct_answer,
      r.is_correct ? 1 : 0,
      r.response_time_ms,
      r.error_tag,
      JSON.stringify(r.hidden_metrics_delta),
      r.session_id,
      r.position,
      r.created_at,
    );
  }
  return rows.length;
}

/**
 * Which of the five metrics an item feeds, per Section 3. PI and RL are fed by
 * every character- or time-scored item; the rest are item-shape specific.
 */
export function hiddenDeltaFor(
  attempt: Pick<Attempt, 'item_kind' | 'counted_chars' | 'correct_chars' | 'latency_ms' | 'slot_category' | 'delayed_recall' | 'clarity_score' | 'item_id' | 'correct'>,
  moduleId: string,
): HiddenMetricDelta {
  const metrics: string[] = ['precision_index', 'reflex_latency_pct_of_baseline'];
  const contribution: Record<string, number> = {};

  const charShare = attempt.counted_chars > 0 ? (attempt.correct_chars / attempt.counted_chars) * 100 : 0;
  contribution['precision_index'] = Number(charShare.toFixed(2));
  /* RL is a ratio against the candidate's own baseline (core/metrics.ts), so
     the per-attempt record carries the numerator rather than a fake percent. */
  contribution['reflex_latency_pct_of_baseline'] = Number(attempt.latency_ms.toFixed(2));

  const basis: string[] = [`${moduleId}/${attempt.item_kind}`];

  if (attempt.delayed_recall) {
    metrics.push('retention_density');
    contribution['retention_density'] = attempt.correct_chars > 0 ? 2 : 0;
    basis.push('delayed recall weighted 2x');
  }

  if (typeof attempt.clarity_score === 'number' && Number.isFinite(attempt.clarity_score)) {
    metrics.push('vocal_clarity_delta');
    contribution['vocal_clarity_delta'] = Number(attempt.clarity_score.toFixed(2));
    basis.push('clarity sample against baseline');
  }

  const isSlot = attempt.item_kind.startsWith('slot') || attempt.slot_category !== null;
  const moduleFeedsPti = MODULES[moduleId as keyof typeof MODULES]?.contributes_pti === true;
  if (isSlot && moduleFeedsPti) {
    metrics.push('pattern_intuition');
    /* The engine scores PTI as the percentage of eligible slot attempts that
       were correct, so one attempt contributes either 100 or 0. */
    contribution['pattern_intuition'] = attempt.correct ? 100 : 0;
    basis.push('errorless slot substitution');
  }

  if (contribution['reflex_latency_pct_of_baseline'] !== undefined) {
    basis.push('latency numerator; ratio taken against the candidate baseline');
  }

  return { metrics: [...new Set(metrics)], contribution, basis: basis.join(' · ') };
}

/**
 * Prompt text is best-effort: the planner is seeded per candidate, so an item
 * id is all the archive can guarantee. When the item is still available in the
 * content bank we recover the readable text; otherwise the id stands in. The
 * archive is for later querying, so the id remains a valid key either way.
 */
function questionFor(itemId: string, payload?: unknown): string {
  const fromPayload = describeItem(payload);
  if (fromPayload) return fromPayload;
  return itemId;
}

function describeItem(item: unknown): string {
  if (!item || typeof item !== 'object') return '';
  const record = item as Record<string, unknown>;
  for (const key of ['text', 'target', 'sequence', 'passage', 'prompt', 'word', 'scene_id']) {
    const v = record[key];
    if (typeof v === 'string' && v.length) return v.slice(0, 400);
  }
  return '';
}

export function buildArchiveRows(args: {
  userId: string;
  sessionId: string;
  moduleId: string;
  attempts: Attempt[];
  timestamp: string;
  /** Optional item payloads from the client, used only to recover prompt text. */
  itemPayloads?: unknown[];
}): ExerciseAttemptInput[] {
  const byId = new Map<string, unknown>();
  for (const raw of args.itemPayloads ?? []) {
    if (raw && typeof raw === 'object') {
      const rec = raw as Record<string, unknown>;
      if (typeof rec['item_id'] === 'string') byId.set(rec['item_id'], rec);
    }
  }
  return args.attempts.map((a, i) => ({
    user_id: args.userId,
    module_id: args.moduleId,
    exercise_id: a.item_id,
    question_shown: questionFor(a.item_id, byId.get(a.item_id)),
    answer_given: a.input,
    correct_answer: a.expected,
    is_correct: a.correct,
    response_time_ms: a.latency_ms,
    error_tag: a.error_code as ErrorTagCode,
    hidden_metrics_delta: hiddenDeltaFor(a, args.moduleId),
    session_id: args.sessionId,
    position: i,
    created_at: args.timestamp,
  }));
}
