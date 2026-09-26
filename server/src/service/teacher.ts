import { getDb, plainAll } from '../db/index.js';
import { MODULES } from '../core/modules.js';
import { plainCategory, plainModule, plainRank } from '../core/plain.js';
import { activeLocks, listSessions, lockHistory, openRemediations, allWindows } from '../db/repo.js';
import { buildDashboard, type DashboardPayload } from './dashboard.js';
import { findUserById, listUsers, publicUser } from './auth.js';
import { todayUtc } from '../util.js';
import type { ModuleId } from '../core/types.js';

export interface AdminCandidateRow {
  id: string;
  display_name: string;
  email: string;
  calibrated: boolean;
  current_rank: string;
  rank_plain: string;
  streak: number;
  sessions_total: number;
  last_active: string | null;
  active_locks: number;
  weekly_accuracy: number | null;
}

function sessionsTotal(userId: string): number {
  const db = getDb();
  const r = db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE candidate_id = ?').get(userId) as { n?: number } | undefined;
  return r?.n ?? 0;
}

function lastActive(userId: string): string | null {
  const db = getDb();
  const r = db.prepare('SELECT MAX(started_at) AS last FROM sessions WHERE candidate_id = ?').get(userId) as
    | { last?: string | null }
    | undefined;
  return r?.last ?? null;
}

export function listCandidatesForTeacher(): AdminCandidateRow[] {
  const db = getDb();
  return listUsers()
    .filter((u) => u.role === 'candidate')
    .map((u) => {
      const streak = db.prepare('SELECT current FROM streaks WHERE candidate_id = ?').get(u.id) as
        | { current?: number }
        | undefined;
      const week = db
        .prepare(
          `SELECT AVG(accuracy_pct) AS acc FROM sessions
            WHERE candidate_id = ? AND started_at >= datetime('now', '-7 days')`,
        )
        .get(u.id) as { acc?: number | null } | undefined;
      const rankRow = db
        .prepare('SELECT rank FROM rank_history WHERE candidate_id = ? ORDER BY at DESC LIMIT 1')
        .get(u.id) as { rank?: string } | undefined;
      return {
        id: u.id,
        display_name: u.display_name,
        email: u.email,
        calibrated: publicUser(u).calibrated,
        current_rank: rankRow?.rank ?? 'RANK 03: DECODER',
        rank_plain: plainRank(rankRow?.rank ?? 'RANK 03: DECODER'),
        streak: streak?.current ?? 0,
        sessions_total: sessionsTotal(u.id),
        last_active: lastActive(u.id),
        active_locks: activeLocks(u.id).filter((l) => l.remediation_active).length,
        weekly_accuracy: week?.acc != null ? Number(week.acc.toFixed(2)) : null,
      };
    });
}

export interface TeacherDetail {
  candidate: AdminCandidateRow;
  dashboard: DashboardPayload;
  pcp: unknown | null;
  structural_locks: {
    key: string;
    module_id: string;
    module_plain: string;
    tag: string;
    tag_plain: string;
    sessions_flagged: number;
    sessions_remaining: number;
    diversion_pct: number;
    blocks_escalation: boolean;
    active: boolean;
    triggered_at: string;
    cleared_at: string | null;
  }[];
  error_tag_frequency: { tag: string; plain: string; count: number; last_seen: string }[];
  ape_history: { module_id: string; factor: number; threshold_before_ms: number; threshold_after_ms: number; recorded_at: string; reason: string }[];
  rolling_windows: Record<string, { threshold_ms: number; speed_multiplier: number; sessions: number; mean_accuracy: number }>;
  pending_remediation: ModuleId[];
  recent_attempts: {
    exercise_id: string;
    module_id: string;
    question_shown: string;
    answer_given: string | null;
    is_correct: boolean;
    response_time_ms: number;
    error_tag: string | null;
    error_plain: string | null;
    hidden_metrics_delta: string;
    created_at: string;
  }[];
  recent_sessions: { session_id: string; module_id: string; module_plain: string; accuracy_pct: number; mean_latency_ms: number; started_at: string }[];
  recommendation: string;
}

/**
 * Section 13.6. Same underlying Structural Lock data as the candidate's view,
 * phrased as a decision someone can act on rather than a system event.
 */
export function weeklyRecommendation(userId: string, name: string): string {
  const locks = activeLocks(userId).filter((l) => l.remediation_active);
  if (locks.length === 0) {
    const week = getDb()
      .prepare(
        `SELECT COUNT(*) AS n, AVG(accuracy_pct) AS acc FROM sessions
          WHERE candidate_id = ? AND started_at >= datetime('now', '-7 days')`,
      )
      .get(userId) as { n?: number; acc?: number | null } | undefined;
    if (!week?.n) return `${name} has not practised this week. Consider a short check-in to see how it is going.`;
    return `${name} completed ${week.n} session${week.n === 1 ? '' : 's'} this week at ${(week.acc ?? 0).toFixed(2)}% average, with no active focus areas. On track — no manual review needed.`;
  }

  const worst = [...locks].sort((a, b) => b.sessions_flagged - a.sessions_flagged)[0]!;
  const topic = plainCategory(worst.tag);
  const plural = locks.length > 1 ? ` and ${locks.length - 1} other area${locks.length > 2 ? 's' : ''}` : '';
  return (
    `${name} is struggling with ${topic} (${worst.sessions_flagged} recurrences, ${worst.sessions_remaining} focused sessions left)${plural}. ` +
    `Recommend manual review${MODULES[worst.module_id as ModuleId] ? ` of ${plainModule(worst.module_id)}` : ''}.`
  );
}

export function teacherDetail(userId: string): TeacherDetail {
  const db = getDb();
  const user = findUserById(userId);
  if (!user) throw new Error('candidate not found');

  const summary = listCandidatesForTeacher().find((c) => c.id === userId)!;
  const pcpRow = db.prepare('SELECT * FROM pcp WHERE candidate_id = ?').get(userId) as Record<string, unknown> | undefined;
  const blockTotal = 45 * 60;

  const tagRows = plainAll<{ error_tag: string; n: number; last: string }>(
    db
      .prepare(
        `SELECT error_tag, COUNT(*) AS n, MAX(created_at) AS last
           FROM exercise_attempts
          WHERE user_id = ? AND error_tag IS NOT NULL AND error_tag != 'ACCEPTED'
            AND created_at >= datetime('now', '-30 days')
          GROUP BY error_tag ORDER BY n DESC`,
      )
      .all(userId) as unknown[],
  );

  const windows = allWindows(userId);
  const apeHistory = plainAll<{
    module_id: string;
    window: string;
  }>(db.prepare('SELECT module_id, window FROM rolling_windows WHERE candidate_id = ?').all(userId) as unknown[]);

  const ape: TeacherDetail['ape_history'] = [];
  for (const w of apeHistory) {
    const parsed = JSON.parse(w.window) as { adjustment_factor_log?: unknown[] };
    for (const entry of (parsed.adjustment_factor_log ?? []).slice(-3) as Record<string, unknown>[]) {
      ape.push({
        module_id: w.module_id,
        factor: Number(entry['factor'] ?? 1),
        threshold_before_ms: Number(entry['threshold_before_ms'] ?? 0),
        threshold_after_ms: Number(entry['threshold_after_ms'] ?? 0),
        recorded_at: String(entry['recorded_at'] ?? ''),
        reason: String(entry['reason'] ?? ''),
      });
    }
  }
  ape.sort((a, b) => (a.recorded_at < b.recorded_at ? 1 : -1));

  return {
    candidate: summary,
    dashboard: buildDashboard(userId, user.display_name, blockTotal),
    pcp: pcpRow ?? null,
    structural_locks: lockHistory(userId).map((l) => ({
      key: `${l.module_id}:${l.tag}:${l.triggered_at}`,
      module_id: l.module_id,
      module_plain: plainModule(l.module_id),
      tag: l.tag,
      tag_plain: plainCategory(l.tag),
      sessions_flagged: l.sessions_flagged,
      sessions_remaining: l.sessions_remaining,
      diversion_pct: l.diversion_pct,
      blocks_escalation: l.blocks_escalation,
      active: l.remediation_active,
      triggered_at: l.triggered_at,
      cleared_at: l.cleared_at,
    })),
    error_tag_frequency: tagRows.map((r) => ({ tag: r.error_tag, plain: plainCategory(r.error_tag), count: r.n, last_seen: r.last })),
    ape_history: ape.slice(0, 25),
    rolling_windows: Object.fromEntries(
      (Object.keys(MODULES) as ModuleId[]).map((m) => {
        const w = windows[m];
        return [
          m,
          {
            threshold_ms: w?.current_threshold_ms ?? 0,
            speed_multiplier: w?.speed_multiplier ?? 1,
            sessions: w?.last_8_sessions?.length ?? 0,
            mean_accuracy:
              w?.last_8_sessions?.length
                ? Number(
                    (
                      w.last_8_sessions.reduce((a, s) => a + s.accuracy_pct, 0) / w.last_8_sessions.length
                    ).toFixed(2),
                  )
                : 0,
          },
        ];
      }),
    ),
    pending_remediation: openRemediations(userId),
    recent_attempts: recentAttempts(userId),
    recent_sessions: listSessions(userId, 20).map((s) => ({
      session_id: s.session_id,
      module_id: s.module_id,
      module_plain: plainModule(s.module_id),
      accuracy_pct: s.accuracy_pct,
      mean_latency_ms: s.mean_latency_ms,
      started_at: s.started_at,
    })),
    recommendation: weeklyRecommendation(userId, user.display_name),
  };
}

export { todayUtc };

/**
 * Section 13.4. The permanent attempt record is teacher-only; candidates never
 * see raw rows, and this only ever reads one candidate's own history.
 */
function recentAttempts(userId: string, limit = 50) {
  return plainAll<{
    exercise_id: string;
    module_id: string;
    question_shown: string;
    answer_given: string | null;
    is_correct: number;
    response_time_ms: number;
    error_tag: string | null;
    error_plain: string | null;
    hidden_metrics_delta: string;
    created_at: string;
  }>(
    getDb()
      .prepare(
        `SELECT exercise_id, module_id, question_shown, answer_given, is_correct, response_time_ms,
                error_tag, hidden_metrics_delta, created_at
           FROM exercise_attempts
          WHERE user_id = ?
          ORDER BY created_at DESC, rowid DESC
          LIMIT ?`,
      )
      .all(userId, limit) as unknown[],
  ).map((r) => ({ ...r, is_correct: r.is_correct === 1, error_plain: r.error_tag ? plainCategory(r.error_tag) : null }));
}
