import { getDb } from '../db/index.js';
import { RANK_ORDER, rankIndex } from '../core/modules.js';
import type { CandidateId, ModuleId, Rank } from '../core/types.js';

const METRIC_KEYS = [
  'precision_index',
  'reflex_latency_pct_of_baseline',
  'retention_density',
  'vocal_clarity_delta',
  'pattern_intuition',
] as const;

export type MetricKey = (typeof METRIC_KEYS)[number];

/**
 * Section 13.2. Candidate-facing names. `direction` records whether a HIGHER
 * number is better, which is what the green/red split depends on: for latency a
 * falling number is progress, so a decline there must not be painted red as
 * "went down" without regard to meaning.
 */
export const METRIC_META: Record<MetricKey, { label: string; blurb: string; direction: 'up' | 'down' }> = {
  precision_index: { label: 'Accuracy', blurb: 'How often your answers are right.', direction: 'up' },
  reflex_latency_pct_of_baseline: { label: 'Speed', blurb: 'How fast you answer, against your own baseline.', direction: 'down' },
  retention_density: { label: 'Memory', blurb: 'How well you hold onto material from earlier.', direction: 'up' },
  vocal_clarity_delta: { label: 'Clarity', blurb: 'How clearly your voice is recognised.', direction: 'up' },
  pattern_intuition: { label: 'Pattern sense', blurb: 'How reliably you spot the rule in a sentence.', direction: 'up' },
};

export interface MovementCounts {
  green: number;
  red: number;
  flat: number;
  /** Share of all *movements* (green + red) that were green, as a percentage. */
  green_pct: number;
  /** Share of all movements that were red, as a percentage. */
  red_pct: number;
}

export interface MetricStats extends MovementCounts {
  key: MetricKey;
  label: string;
  blurb: string;
  direction: 'up' | 'down';
  current: number;
  first: number;
  delta: number;
  /** Current value minus the first recorded value, as a percentage. */
  change_pct: number;
  points: Array<{ at: string; value: number }>;
}

export interface RankImpact {
  rank: Rank;
  label: string;
  at: string;
  /** Sessions between this promotion/demotion and the one before it. */
  sessions_since_previous: number | null;
}

export interface ModuleStat {
  module_id: ModuleId;
  sessions: number;
  attempts: number;
  correct: number;
  accuracy_pct: number;
  mean_latency_ms: number;
  last_played_at: string | null;
}

export interface StrengthWeakness {
  key: MetricKey;
  label: string;
  blurb: string;
  value: number;
  /** 0-100, relative to the candidate's own observed range for this metric. */
  score: number;
}

export interface StatsBundle {
  metrics: MetricStats[];
  /** Overall green/red split across every metric. */
  overall: MovementCounts;
  strengths: StrengthWeakness[];
  weaknesses: StrengthWeakness[];
  rank_current: Rank | null;
  rank_current_label: string;
  rank_history: RankImpact[];
  promotions: number;
  demotions: number;
  modules: ModuleStat[];
  /** Share of sessions that were delayed-recall checks, as a percentage. */
  delayed_recall_pct: number;
  /** Accuracy of delayed-recall sessions versus everything else. */
  delayed_recall_accuracy_pct: number;
  standard_accuracy_pct: number;
}

function round2(n: number): number {
  return Number(n.toFixed(2));
}

function parseMetrics(raw: unknown): Record<string, number> {
  if (typeof raw !== 'string' || !raw) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === 'object' ? (v as Record<string, number>) : {};
  } catch {
    return {};
  }
}

/** Counts a movement as green/red only when it means progress for this metric. */
function classify(delta: number, direction: 'up' | 'down', epsilon = 0.01): 'green' | 'red' | 'flat' {
  if (Math.abs(delta) < epsilon) return 'flat';
  const improved = direction === 'up' ? delta > 0 : delta < 0;
  return improved ? 'green' : 'red';
}

function tally(counts: { green: number; red: number; flat: number }): MovementCounts {
  const moved = counts.green + counts.red;
  return {
    green: counts.green,
    red: counts.red,
    flat: counts.flat,
    green_pct: moved > 0 ? round2((counts.green / moved) * 100) : 0,
    red_pct: moved > 0 ? round2((counts.red / moved) * 100) : 0,
  };
}

/**
 * The full STATS read model. Everything is derived from append-only history
 * (`metric_history`, `rank_history`, `sessions`, `session_attempts`), so the
 * numbers can always be recomputed from the record.
 */
export async function statsFor(candidateId: CandidateId): Promise<StatsBundle> {
  const db = getDb();

  const historyRows = (await db
    .prepare('SELECT metrics, at FROM metric_history WHERE candidate_id = ? ORDER BY at, id')
    .all(candidateId)) as Array<Record<string, unknown>>;

  const total = { green: 0, red: 0, flat: 0 };
  const metrics: MetricStats[] = METRIC_KEYS.map((key) => {
    const meta = METRIC_META[key];
    const points = historyRows
      .map((r) => ({ at: String(r['at']), value: Number(parseMetrics(r['metrics'])[key] ?? 0) }))
      .filter((p) => Number.isFinite(p.value));

    const counts = { green: 0, red: 0, flat: 0 };
    for (let i = 1; i < points.length; i++) {
      counts[classify(points[i]!.value - points[i - 1]!.value, meta.direction)]++;
    }
    total.green += counts.green;
    total.red += counts.red;
    total.flat += counts.flat;

    const first = points[0]?.value ?? 0;
    const current = points[points.length - 1]?.value ?? 0;
    const delta = current - first;

    return {
      key,
      label: meta.label,
      blurb: meta.blurb,
      direction: meta.direction,
      current: round2(current),
      first: round2(first),
      delta: round2(delta),
      change_pct: first !== 0 ? round2((delta / Math.abs(first)) * 100) : 0,
      points: points.map((p) => ({ at: p.at, value: round2(p.value) })),
      ...tally(counts),
    };
  });

  // Strengths and weaknesses: normalise each metric against the candidate's own
  // observed range, so a metric that moves 2 points is not judged beside one
  // that moves 40.
  const scored: StrengthWeakness[] = metrics.map((m) => {
    const values = m.points.map((p) => p.value);
    const lo = values.length ? Math.min(...values) : 0;
    const hi = values.length ? Math.max(...values) : 0;
    const score = hi > lo ? round2(((m.current - lo) / (hi - lo)) * 100) : m.current > 0 ? 100 : 0;
    return { key: m.key, label: m.label, blurb: m.blurb, value: m.current, score };
  });
  const withEvidence = scored.filter((s) => s.key !== 'pattern_intuition' || s.value > 0);
  const strengths = [...withEvidence].sort((a, b) => b.score - a.score || b.value - a.value).slice(0, 3);
  const weaknesses = [...withEvidence].sort((a, b) => a.score - b.score || a.value - b.value).slice(0, 3);

  /* Rank history, with the number of sessions between consecutive changes. */
  const rankRows = (await db
    .prepare('SELECT rank, at FROM rank_history WHERE candidate_id = ? ORDER BY at, id')
    .all(candidateId)) as Array<Record<string, unknown>>;

  const sessionTimes = new Map<string, number>();
  for (const r of (await db
    .prepare('SELECT session_id, started_at FROM sessions WHERE candidate_id = ? ORDER BY started_at')
    .all(candidateId)) as Array<Record<string, unknown>>) {
    sessionTimes.set(String(r['session_id']), Date.parse(String(r['started_at'])));
  }

  const rankHistory: RankImpact[] = rankRows.map((r, i) => {
    const prev = rankRows[i - 1];
    const at = String(r['at']);
    let since: number | null = null;
    if (prev) {
      const a = Date.parse(String(prev['at']));
      const b = Date.parse(at);
      if (Number.isFinite(a) && Number.isFinite(b)) {
        const between = [...sessionTimes.values()].filter((t) => t > a && t <= b).length;
        since = between;
      }
    }
    return { rank: String(r['rank']) as Rank, label: String(r['rank']), at, sessions_since_previous: since };
  });

  let promotions = 0;
  let demotions = 0;
  for (let i = 1; i < rankHistory.length; i++) {
    const before = rankIndex(rankHistory[i - 1]!.rank);
    const after = rankIndex(rankHistory[i]!.rank);
    if (after > before) promotions++;
    else if (after < before) demotions++;
  }
  const rank_current = rankHistory[rankHistory.length - 1]?.rank ?? null;

  /* Per-module bars. */
  const moduleRows = (await db
    .prepare(
      `SELECT s.module_id,
              COUNT(DISTINCT s.session_id) AS sessions,
              COUNT(a.id) AS attempts,
              COALESCE(SUM(CASE WHEN a.correct = 1 THEN 1 ELSE 0 END), 0) AS correct,
              COALESCE(AVG(a.latency_ms), 0) AS mean_latency,
              MAX(s.started_at) AS last_played
         FROM sessions s
         LEFT JOIN session_attempts a ON a.session_id = s.session_id
        WHERE s.candidate_id = ?
        GROUP BY s.module_id
        ORDER BY s.module_id`,
    )
    .all(candidateId)) as Array<Record<string, unknown>>;

  const modules: ModuleStat[] = moduleRows.map((r) => {
    const attempts = Number(r['attempts'] ?? 0);
    const correct = Number(r['correct'] ?? 0);
    return {
      module_id: String(r['module_id']) as ModuleId,
      sessions: Number(r['sessions'] ?? 0),
      attempts,
      correct,
      accuracy_pct: attempts > 0 ? round2((correct / attempts) * 100) : 0,
      mean_latency_ms: round2(Number(r['mean_latency'] ?? 0)),
      last_played_at: r['last_played'] === null ? null : String(r['last_played']),
    };
  });

  /* Delayed recall, for the pie. */
  const recallRow = (await db
    .prepare(
      `SELECT COUNT(*) AS n,
              COALESCE(AVG(accuracy_pct), 0) AS acc
         FROM sessions
        WHERE candidate_id = ? AND is_delayed_recall = 1`,
    )
    .get(candidateId)) as Record<string, unknown> | undefined;
  const standardRow = (await db
    .prepare(
      `SELECT COUNT(*) AS n,
              COALESCE(AVG(accuracy_pct), 0) AS acc
         FROM sessions
        WHERE candidate_id = ? AND is_delayed_recall = 0`,
    )
    .get(candidateId)) as Record<string, unknown> | undefined;

  const recallN = Number(recallRow?.['n'] ?? 0);
  const standardN = Number(standardRow?.['n'] ?? 0);
  const allN = recallN + standardN;

  return {
    metrics,
    overall: tally(total),
    strengths,
    weaknesses,
    rank_current,
    rank_current_label: rank_current ?? RANK_ORDER[0]!,
    rank_history: rankHistory,
    promotions,
    demotions,
    modules,
    delayed_recall_pct: allN > 0 ? round2((recallN / allN) * 100) : 0,
    delayed_recall_accuracy_pct: round2(Number(recallRow?.['acc'] ?? 0)),
    standard_accuracy_pct: round2(Number(standardRow?.['acc'] ?? 0)),
  };
}
