import { getDb, plainAll, parseJson } from '../db/index.js';
import { MODULES, PHASE_UNLOCK_RANK, RANK_ORDER } from '../core/modules.js';
import { METRIC_DIRECTION, type MetricKey } from '../core/metrics.js';
import { canUnlockPhase, evaluateRanks, MASTER_WINDOW_DAYS } from '../core/ranks.js';
import { plainModule } from '../core/plain.js';
import {
  activeLocks,
  allWindows,
  currentRank,
  getPcp,
  getWindow,
  lockHistory,
  openRemediations,
  phaseSessions,
  sessionSummaries,
} from '../db/repo.js';
import { todayUtc } from '../util.js';
import type { ModuleId, Rank } from '../core/types.js';

const METRIC_KEYS: MetricKey[] = [
  'precision_index',
  'reflex_latency_pct_of_baseline',
  'retention_density',
  'vocal_clarity_delta',
  'pattern_intuition',
];

export const METRIC_PLAIN: Record<MetricKey, { label: string; blurb: string }> = {
  precision_index: { label: 'Accuracy', blurb: 'How many characters you get right at your current speed.' },
  reflex_latency_pct_of_baseline: { label: 'Response speed', blurb: 'How fast you answer, compared to your own starting point.' },
  retention_density: { label: 'Remembering', blurb: 'How much you keep — later recall counts for more.' },
  vocal_clarity_delta: { label: 'Speaking clarity', blurb: 'How clearly your words come through, versus your start.' },
  pattern_intuition: { label: 'Pattern feel', blurb: 'How often you get a changing word pattern right first time.' },
};

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + n);
  return out;
}

export async function streakHeatmap(
  userId: string,
  weeks = 26,
): Promise<{ days: { date: string; level: number; pct: number; sessions: number }[]; current: number; longest: number }> {
  const db = getDb();
  const today = new Date(`${todayUtc()}T00:00:00.000Z`);
  const start = addDays(today, -(weeks * 7 - 1));
  start.setUTCDate(start.getUTCDate() - start.getUTCDay());

  const rows = plainAll<{ date: string; aggregate_pct: number; sessions: number }>(
    await db
      .prepare(
        `SELECT d.date AS date,
                d.aggregate_pct AS aggregate_pct,
                (SELECT COUNT(*) FROM sessions s
                  WHERE s.candidate_id = d.candidate_id AND substr(s.started_at, 1, 10) = d.date) AS sessions
           FROM daily_log d
          WHERE d.candidate_id = ?
            AND d.date >= ?
          ORDER BY d.date`,
      )
      .all(userId, dayKey(start)),
  );

  const byDate = new Map(rows.map((r) => [r.date, r]));
  const days: { date: string; level: number; pct: number; sessions: number }[] = [];
  for (let i = 0; i < weeks * 7; i++) {
    const d = addDays(start, i);
    const key = dayKey(d);
    const hit = byDate.get(key);
    const pct = hit?.aggregate_pct ?? 0;
    const sessions = hit?.sessions ?? 0;
    const future = d.getTime() > today.getTime();
    const level = future || sessions === 0 ? 0 : pct >= 95 ? 4 : pct >= 90 ? 3 : pct >= 80 ? 2 : 1;
    days.push({ date: key, level, pct, sessions });
  }

  let longest = 0;
  let run = 0;
  for (const day of days) {
    if (day.level > 0) {
      run++;
      if (run > longest) longest = run;
    } else if (day.date <= todayUtc()) {
      run = 0;
    }
  }

  const streakRow = (await db.prepare('SELECT current FROM streaks WHERE candidate_id = ?').get(userId)) as
    | { current?: number }
    | undefined;

  return { days, current: streakRow?.current ?? 0, longest };
}

export interface TrendPoint {
  date: string;
  value: number;
}

export interface TrendSeries {
  key: MetricKey;
  label: string;
  blurb: string;
  direction: 'HIGHER_BETTER' | 'LOWER_BETTER';
  unit: string;
  points: TrendPoint[];
  current: number;
  /** (current window avg - prior window avg) / prior window avg, as a percent. */
  change_pct: number | null;
}

export async function metricTrends(userId: string, days = 30): Promise<TrendSeries[]> {
  const db = getDb();
  const today = new Date(`${todayUtc()}T00:00:00.000Z`);
  const from = dayKey(addDays(today, -(days - 1)));

  const rows = plainAll<{ at: string; metrics: string }>(
    await db
      .prepare(
        `SELECT at, metrics FROM metric_history
          WHERE candidate_id = ? AND substr(at, 1, 10) >= ?
          ORDER BY at`,
      )
      .all(userId, from),
  );

  const current = (await db.prepare('SELECT * FROM metrics WHERE candidate_id = ?').get(userId)) as
    | Record<string, number>
    | undefined;

  const midpoint = dayKey(addDays(today, -Math.floor(days / 2)));

  return METRIC_KEYS.map((key) => {
    const points: TrendPoint[] = rows.map((r) => ({
      date: r.at.slice(0, 10),
      value: Number((parseJson<Record<string, number>>(r.metrics, {})[key] ?? 0).toFixed(2)),
    }));
    // Carry the live value forward so the line reaches "now" even if the last
    // history write was a recalibration rather than a session.
    const nowValue = current ? Number((current[key] ?? 0).toFixed(2)) : (points.at(-1)?.value ?? 0);
    const live = [...points];
    if (live.length === 0 || live[live.length - 1]!.date !== todayUtc()) {
      live.push({ date: todayUtc(), value: nowValue });
    } else {
      live[live.length - 1]!.value = nowValue;
    }

    const prior = live.filter((p) => p.date < midpoint).map((p) => p.value);
    const recent = live.filter((p) => p.date >= midpoint).map((p) => p.value);
    const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
    const priorAvg = avg(prior);
    const recentAvg = avg(recent);
    const change_pct = priorAvg === 0 ? null : Number((((recentAvg - priorAvg) / priorAvg) * 100).toFixed(1));

    return {
      key,
      label: METRIC_PLAIN[key].label,
      blurb: METRIC_PLAIN[key].blurb,
      direction: METRIC_DIRECTION[key],
      unit: key === 'reflex_latency_pct_of_baseline' ? '%' : key === 'vocal_clarity_delta' ? 'pts' : '%',
      points: live,
      current: nowValue,
      change_pct,
    };
  });
}

export interface ModuleBreakdown {
  module_id: string;
  label: string;
  title: string;
  accuracy_pct: number;
  avg_response_ms: number;
  attempts: number;
  sessions: number;
}

export async function moduleBreakdown(userId: string, days = 30): Promise<ModuleBreakdown[]> {
  const db = getDb();
  const since = `${dayKey(addDays(new Date(`${todayUtc()}T00:00:00.000Z`), -(days - 1)))}`;
  const rows = plainAll<{
    module_id: string;
    accuracy: number;
    avg_ms: number;
    attempts: number;
    sessions: number;
  }>(
    await db
      .prepare(
        `SELECT module_id,
                AVG(CASE WHEN is_correct = 1 THEN 100.0 ELSE 0.0 END) AS accuracy,
                AVG(response_time_ms) AS avg_ms,
                COUNT(*) AS attempts,
                COUNT(DISTINCT session_id) AS sessions
           FROM exercise_attempts
          WHERE user_id = ? AND substr(created_at, 1, 10) >= ?
          GROUP BY module_id`,
      )
      .all(userId, since),
  );

  return (Object.keys(MODULES) as ModuleId[]).map((id) => {
    const hit = rows.find((r) => r.module_id === id);
    return {
      module_id: id,
      label: plainModule(id),
      title: MODULES[id].title,
      accuracy_pct: Number((hit?.accuracy ?? 0).toFixed(2)),
      avg_response_ms: Math.round(hit?.avg_ms ?? 0),
      attempts: hit?.attempts ?? 0,
      sessions: hit?.sessions ?? 0,
    };
  });
}

export async function rankCard(userId: string): Promise<{
  current: Rank;
  next: Rank | null;
  progress_pct: number;
  requirements: { label: string; met: boolean; detail: string }[];
  next_unlocks: { rank: Rank; what: string }[];
  unlocked_modules: ModuleId[];
}> {
  const rank = await currentRank(userId);
  const moduleIds = Object.keys(MODULES) as ModuleId[];
  const [windows, locks, history, phase4] = await Promise.all([
    Promise.all(moduleIds.map((m) => getWindow(userId, m))),
    activeLocks(userId),
    lockHistory(userId),
    phaseSessions(userId, 4, Date.now() - MASTER_WINDOW_DAYS * 86400000),
  ]);
  const evaluation = evaluateRanks({
    rank,
    rolling_windows: Object.fromEntries(moduleIds.map((m, i) => [m, windows[i]!])),
    locks,
    lock_history: history,
    phase4_sessions: phase4,
    now: new Date(),
  });

  // Progress toward the next rank only; ranks already held are not progress.
  const nextGate = evaluation.nextRank
    ? evaluation.requirements.find((r) => r.rank === evaluation.nextRank)
    : null;
  const reqs = nextGate ? nextGate.requirements : [];
  const met = reqs.filter((r) => r.met).length;
  const progress_pct = evaluation.nextRank ? Number(((met / Math.max(reqs.length, 1)) * 100).toFixed(2)) : 100;

  const nextUnlocks: { rank: Rank; what: string }[] = [];
  if (evaluation.nextRank) {
    const nextIdx = RANK_ORDER.indexOf(evaluation.nextRank);
    const unlockedPhases = moduleIds
      .map((m) => MODULES[m].phase)
      .filter((p) => PHASE_UNLOCK_RANK[p as 1 | 2 | 3 | 4] === evaluation.nextRank);
    for (const phase of [...new Set(unlockedPhases)]) {
      nextUnlocks.push({
        rank: RANK_ORDER[nextIdx]!,
        what: `${[...new Set(moduleIds.filter((m) => MODULES[m].phase === phase).map(plainModule))].join(', ')}`,
      });
    }
    if (nextUnlocks.length === 0) nextUnlocks.push({ rank: RANK_ORDER[nextIdx]!, what: 'faster, harder material' });
  }

  return {
    current: rank,
    next: evaluation.nextRank,
    progress_pct,
    requirements: reqs.map((r) => ({ label: r.label, met: r.met, detail: r.detail })),
    next_unlocks: nextUnlocks,
    unlocked_modules: moduleIds.filter((m) =>
      canUnlockPhase(MODULES[m].phase as 1 | 2 | 3 | 4, rank, PHASE_UNLOCK_RANK[MODULES[m].phase as 1 | 2 | 3 | 4]),
    ),
  };
}

export interface TodayStatus {
  date: string;
  sessions_completed: number;
  target_sessions: number;
  block_total_s: number;
  state: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETE';
  forced_repeat_modules: ModuleId[];
  active_locks: number;
  aggregate_pct: number | null;
  tier: string | null;
}

export async function todayStatus(userId: string, blockTotalS: number): Promise<TodayStatus> {
  const db = getDb();
  const today = todayUtc();
  const count = (await db
    .prepare('SELECT COUNT(*) AS n FROM sessions WHERE candidate_id = ? AND substr(started_at, 1, 10) = ?')
    .get(userId, today)) as { n?: number } | undefined;
  const sessions = count?.n ?? 0;
  const log = (await db
    .prepare('SELECT aggregate_pct, tier FROM daily_log WHERE candidate_id = ? AND date = ? ORDER BY recorded_at DESC LIMIT 1')
    .get(userId, today)) as { aggregate_pct?: number; tier?: string } | undefined;
  const target = 5;

  const [remediations, locks] = await Promise.all([openRemediations(userId), activeLocks(userId)]);

  return {
    date: today,
    sessions_completed: sessions,
    target_sessions: target,
    block_total_s: blockTotalS,
    state: sessions === 0 ? 'NOT_STARTED' : sessions >= target ? 'COMPLETE' : 'IN_PROGRESS',
    forced_repeat_modules: remediations,
    active_locks: locks.filter((l) => l.remediation_active).length,
    aggregate_pct: log?.aggregate_pct ?? null,
    tier: log?.tier ?? null,
  };
}

export interface DashboardPayload {
  calibrated: boolean;
  display_name: string;
  heatmap: Awaited<ReturnType<typeof streakHeatmap>>;
  trends: TrendSeries[];
  modules: ModuleBreakdown[];
  rank: Awaited<ReturnType<typeof rankCard>>;
  today: TodayStatus;
  pcp_locked: boolean;
}

export async function buildDashboard(
  userId: string,
  displayName: string,
  blockTotalS: number,
): Promise<DashboardPayload> {
  const pcp = await getPcp(userId);
  const [heatmap, trends, modules, rank, today] = await Promise.all([
    streakHeatmap(userId),
    metricTrends(userId),
    moduleBreakdown(userId),
    rankCard(userId),
    todayStatus(userId, blockTotalS),
  ]);
  return {
    calibrated: !!pcp,
    display_name: displayName,
    heatmap,
    trends,
    modules,
    rank,
    today,
    pcp_locked: pcp?.locked === true,
  };
}

export { allWindows, sessionSummaries };
