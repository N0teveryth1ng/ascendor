import { getDb } from '../db/index.js';
import { plainModule } from '../core/plain.js';
import type { CandidateId, ModuleId } from '../core/types.js';

export interface HistoryAttempt {
  id: number;
  position: number;
  item_id: string;
  item_kind: string;
  correct: boolean;
  input: string | null;
  expected: string | null;
  latency_ms: number;
  latency_delta_ms: number | null;
  error_code: string;
  error_category: string | null;
  char_position: number | null;
  counted_chars: number;
  correct_chars: number;
  slot_category: string | null;
  delayed_recall: boolean;
  clarity_score: number | null;
  question_shown: string | null;
  answer_given: string | null;
}

export interface HistoryEntry {
  session_id: string;
  module_id: ModuleId;
  module_name: string;
  phase: number;
  block_id: string | null;
  sublevel: number;
  started_at: string;
  ended_at: string;
  duration_ms: number;
  accuracy_pct: number;
  mean_latency_ms: number;
  threshold_ms: number;
  speed_multiplier: number;
  char_correct: number;
  char_total: number;
  errors: string[];
  ape: Record<string, number>;
  is_delayed_recall: boolean;
  recall_of_session: string | null;
  attempt_count: number;
  error_count: number;
  attempts: HistoryAttempt[];
}

export interface HistoryPage {
  entries: HistoryEntry[];
  total: number;
  limit: number;
  offset: number;
}

function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || raw.length === 0) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * Section 13.4 / the HISTORY surface: every attempted quest, newest first, with
 * the full per-attempt record. This is a read model over `sessions`,
 * `session_attempts` and the append-only `exercise_attempts` archive; nothing
 * here writes, so history cannot be edited through the API.
 *
 * Prompt text and the candidate's actual answer are recovered from
 * `exercise_attempts` (question_shown / answer_given) where available, because
 * `session_attempts` only guarantees the item id.
 */
export async function historyFor(
  candidateId: CandidateId,
  opts: { limit?: number; offset?: number; moduleId?: ModuleId } = {},
): Promise<HistoryPage> {
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);
  const offset = Math.max(opts.offset ?? 0, 0);
  const db = getDb();

  const where = ['candidate_id = ?'];
  const args: unknown[] = [candidateId];
  if (opts.moduleId) {
    where.push('module_id = ?');
    args.push(opts.moduleId);
  }
  const whereSql = where.join(' AND ');

  const totalRow = (await db
    .prepare(`SELECT COUNT(*) AS n FROM sessions WHERE ${whereSql}`)
    .get(...args)) as { n?: number } | undefined;

  const sessions = (await db
    .prepare(
      `SELECT session_id, module_id, phase, block_id, sublevel, started_at, ended_at,
              accuracy_pct, mean_latency_ms, threshold_ms, speed_multiplier,
              char_correct, char_total, errors, ape, is_delayed_recall, recall_of_session
         FROM sessions
        WHERE ${whereSql}
        ORDER BY started_at DESC, session_id DESC
        LIMIT ? OFFSET ?`,
    )
    .all(...args, limit, offset)) as Array<Record<string, unknown>>;

  // The shim has no array-parameter support, so fetch the page's attempts with
  // one query per session, all in parallel.
  const perSession = await Promise.all(
    sessions.map(async (s) => {
      const rows = (await db
        .prepare(
          `SELECT a.id, a.position, a.item_id, a.item_kind, a.correct,
                  a.input, a.expected, a.latency_ms, a.latency_delta_ms, a.error_code,
                  a.error_category, a.char_position, a.counted_chars, a.correct_chars,
                  a.slot_category, a.delayed_recall, a.clarity_score,
                  x.question_shown, x.answer_given
             FROM session_attempts a
             LEFT JOIN LATERAL (
               SELECT question_shown, answer_given
                 FROM exercise_attempts x
                WHERE x.session_id = a.session_id AND x.exercise_id = a.item_id
                LIMIT 1
             ) x ON TRUE
            WHERE a.candidate_id = ? AND a.session_id = ?
            ORDER BY a.position`,
        )
        .all(candidateId, s['session_id'])) as Array<Record<string, unknown>>;
      return [String(s['session_id']), rows] as const;
    }),
  );

  const bySession = new Map(perSession);

  const entries: HistoryEntry[] = sessions.map((s) => {
    const rows = bySession.get(String(s['session_id'])) ?? [];
    const started = Date.parse(String(s['started_at']));
    const ended = Date.parse(String(s['ended_at']));
    return {
      session_id: String(s['session_id']),
      module_id: String(s['module_id']) as ModuleId,
      module_name: plainModule(String(s['module_id'])),
      phase: Number(s['phase']),
      block_id: s['block_id'] === null ? null : String(s['block_id']),
      sublevel: Number(s['sublevel']),
      started_at: String(s['started_at']),
      ended_at: String(s['ended_at']),
      duration_ms: Number.isFinite(started) && Number.isFinite(ended) ? Math.max(0, ended - started) : 0,
      accuracy_pct: Number(s['accuracy_pct']),
      mean_latency_ms: Number(s['mean_latency_ms']),
      threshold_ms: Number(s['threshold_ms']),
      speed_multiplier: Number(s['speed_multiplier']),
      char_correct: Number(s['char_correct']),
      char_total: Number(s['char_total']),
      errors: parseJson<string[]>(s['errors'], []),
      ape: parseJson<Record<string, number>>(s['ape'], {}),
      is_delayed_recall: Number(s['is_delayed_recall']) === 1,
      recall_of_session: s['recall_of_session'] === null ? null : String(s['recall_of_session']),
      attempt_count: rows.length,
      error_count: rows.filter((r) => Number(r['correct']) !== 1).length,
      attempts: rows.map((r) => ({
        id: Number(r['id']),
        position: Number(r['position']),
        item_id: String(r['item_id']),
        item_kind: String(r['item_kind']),
        correct: Number(r['correct']) === 1,
        input: r['input'] === null ? null : String(r['input']),
        expected: r['expected'] === null ? null : String(r['expected']),
        latency_ms: Number(r['latency_ms']),
        latency_delta_ms: r['latency_delta_ms'] === null ? null : Number(r['latency_delta_ms']),
        error_code: String(r['error_code']),
        error_category: r['error_category'] === null ? null : String(r['error_category']),
        char_position: r['char_position'] === null ? null : Number(r['char_position']),
        counted_chars: Number(r['counted_chars']),
        correct_chars: Number(r['correct_chars']),
        slot_category: r['slot_category'] === null ? null : String(r['slot_category']),
        delayed_recall: Number(r['delayed_recall']) === 1,
        clarity_score: r['clarity_score'] === null ? null : Number(r['clarity_score']),
        question_shown: r['question_shown'] === null ? null : String(r['question_shown']),
        answer_given: r['answer_given'] === null ? null : String(r['answer_given']),
      })),
    };
  });

  return { entries, total: Number(totalRow?.n ?? entries.length), limit, offset };
}

export interface HistoryTotals {
  attempts: number;
  sessions: number;
  errors: number;
  correct: number;
  accuracy_pct: number;
  /** Mean of per-session accuracy, which weights long and short quests equally. */
  session_accuracy_pct: number;
  total_duration_ms: number;
  first_attempt_at: string | null;
  last_attempt_at: string | null;
}

export async function historyTotals(candidateId: CandidateId): Promise<HistoryTotals> {
  const db = getDb();
  // session_attempts carries no timestamp of its own; the time an attempt
  // happened is the start of the session that owns it, so the first/last
  // attempt clock comes from the parent sessions row via session_id.
  const a = (await db
    .prepare(
      `SELECT COUNT(*) AS attempts,
              COALESCE(SUM(CASE WHEN sa.correct = 1 THEN 1 ELSE 0 END), 0) AS correct,
              COALESCE(SUM(sa.latency_ms), 0) AS total_ms,
              MIN(s.started_at) AS first_at, MAX(s.started_at) AS last_at
         FROM session_attempts sa
         JOIN sessions s ON s.session_id = sa.session_id
        WHERE sa.candidate_id = ?`,
    )
    .get(candidateId)) as Record<string, unknown> | undefined;

  const s = (await db
    .prepare(
      `SELECT COUNT(*) AS sessions, COALESCE(AVG(accuracy_pct), 0) AS avg_acc,
              COALESCE(SUM(EXTRACT(EPOCH FROM (ended_at::timestamptz - started_at::timestamptz)) * 1000), 0) AS total_ms
         FROM sessions
        WHERE candidate_id = ?`,
    )
    .get(candidateId)) as Record<string, unknown> | undefined;

  const attempts = Number(a?.['attempts'] ?? 0);
  const correct = Number(a?.['correct'] ?? 0);

  return {
    attempts,
    correct,
    errors: Math.max(0, attempts - correct),
    sessions: Number(s?.['sessions'] ?? 0),
    accuracy_pct: attempts > 0 ? Number(((correct / attempts) * 100).toFixed(2)) : 0,
    session_accuracy_pct: Number(Number(s?.['avg_acc'] ?? 0).toFixed(2)),
    total_duration_ms: Number(s?.['total_ms'] ?? 0),
    first_attempt_at: a?.['first_at'] === null || a?.['first_at'] === undefined ? null : String(a['first_at']),
    last_attempt_at: a?.['last_at'] === null || a?.['last_at'] === undefined ? null : String(a['last_at']),
  };
}
