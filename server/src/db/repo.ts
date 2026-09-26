import { getDb, parseJson, plain, plainAll, tx, type Row } from './index.js';
import type {
  Attempt,
  CandidateId,
  Metrics,
  MetricFloors,
  ModuleId,
  Pcp,
  Rank,
  RollingWindow,
  SessionSummary,
  StructuralLock,
} from '../core/types.js';
import { ALL_MODULE_IDS, MODULES } from '../core/modules.js';
import { EMPTY_METRICS, roundMetric } from '../core/metrics.js';
import { nowIso } from '../util.js';

const INITIAL_THRESHOLD = 2400;

/* ── Candidates ───────────────────────────────────────────────────────────── */

export async function createCandidate(id: CandidateId, displayName: string): Promise<void> {
  await getDb()
    .prepare(
      `INSERT INTO candidates (candidate_id, display_name, created_at) VALUES (?, ?, ?)
       ON CONFLICT (candidate_id) DO UPDATE SET display_name = EXCLUDED.display_name`,
    )
    .run(id, displayName, nowIso());
}

export async function listCandidates(): Promise<{ candidate_id: string; display_name: string; created_at: string; calibrated: number }[]> {
  const rows = await getDb()
    .prepare(
      `SELECT c.candidate_id, c.display_name, c.created_at,
              CASE WHEN p.candidate_id IS NULL THEN 0 ELSE 1 END AS calibrated
       FROM candidates c
       LEFT JOIN pcp p ON p.candidate_id = c.candidate_id
       ORDER BY c.created_at`,
    )
    .all();
  return plainAll(rows);
}

export async function candidateExists(id: CandidateId): Promise<boolean> {
  const r = await getDb().prepare('SELECT 1 AS ok FROM candidates WHERE candidate_id = ?').get(id);
  return r !== undefined && r !== null;
}

export async function candidateName(id: CandidateId): Promise<string | null> {
  const r = plain<{ display_name: string }>(
    await getDb().prepare('SELECT display_name FROM candidates WHERE candidate_id = ?').get(id),
  );
  return r?.display_name ?? null;
}

/* ── PCP ──────────────────────────────────────────────────────────────────── */

export async function savePcp(pcp: Pcp): Promise<void> {
  await getDb()
    .prepare(
      `INSERT INTO pcp (candidate_id, calibration_date, vocabulary_band, syntax_ceiling,
                        baseline_reflex_latency_ms, baseline_vocal_clarity, typo_vulnerability_index,
                        flagged_weak_vectors, entry_rank, phase_1_entry_difficulty_seed, vectors, locked)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
       ON CONFLICT(candidate_id) DO UPDATE SET
         calibration_date = excluded.calibration_date,
         vocabulary_band = excluded.vocabulary_band,
         syntax_ceiling = excluded.syntax_ceiling,
         baseline_reflex_latency_ms = excluded.baseline_reflex_latency_ms,
         baseline_vocal_clarity = excluded.baseline_vocal_clarity,
         typo_vulnerability_index = excluded.typo_vulnerability_index,
         flagged_weak_vectors = excluded.flagged_weak_vectors,
         entry_rank = excluded.entry_rank,
         phase_1_entry_difficulty_seed = excluded.phase_1_entry_difficulty_seed,
         vectors = excluded.vectors,
         locked = 1`,
    )
    .run(
      pcp.candidate_id,
      pcp.calibration_date,
      pcp.vocabulary_band,
      pcp.syntax_ceiling,
      pcp.baseline_reflex_latency_ms,
      pcp.baseline_vocal_clarity,
      pcp.typo_vulnerability_index,
      JSON.stringify(pcp.flagged_weak_vectors),
      pcp.entry_rank,
      JSON.stringify(pcp.phase_1_entry_difficulty_seed),
      JSON.stringify(pcp.vectors),
    );
}

export async function getPcp(candidateId: CandidateId): Promise<Pcp | null> {
  const row = plain<Row>(await getDb().prepare('SELECT * FROM pcp WHERE candidate_id = ?').get(candidateId));
  if (!row) return null;
  return {
    candidate_id: row.candidate_id as string,
    calibration_date: row.calibration_date as string,
    vocabulary_band: row.vocabulary_band as Pcp['vocabulary_band'],
    syntax_ceiling: row.syntax_ceiling as Pcp['syntax_ceiling'],
    baseline_reflex_latency_ms: Number(row.baseline_reflex_latency_ms),
    baseline_vocal_clarity: Number(row.baseline_vocal_clarity),
    typo_vulnerability_index: Number(row.typo_vulnerability_index),
    flagged_weak_vectors: parseJson<string[]>(row.flagged_weak_vectors, []),
    entry_rank: row.entry_rank as Rank,
    phase_1_entry_difficulty_seed: parseJson(row.phase_1_entry_difficulty_seed, {
      latency_threshold_ms: INITIAL_THRESHOLD,
      speed_multiplier: 1,
      wpm_ceiling: 180,
      flash_duration_ms: 2000,
      phase1_sublevel: {} as Record<string, number>,
    }),
    vectors: parseJson(row.vectors, []),
    locked: Number(row.locked) === 1,
  };
}

export async function insertCalibrationPass(args: {
  candidateId: CandidateId;
  vector: string;
  passType: 'untimed' | 'timed';
  accuracyPct: number;
  meanLatencyMs: number;
  thresholdMs: number;
  wpm: number | null;
  details: unknown;
}): Promise<void> {
  await getDb()
    .prepare(
      `INSERT INTO calibration_passes
         (candidate_id, vector, pass_type, started_at, completed_at, accuracy_pct, mean_latency_ms, threshold_ms, wpm, details)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      args.candidateId,
      args.vector,
      args.passType,
      nowIso(),
      nowIso(),
      args.accuracyPct,
      args.meanLatencyMs,
      args.thresholdMs,
      args.wpm,
      JSON.stringify(args.details),
    );
}

/* ── Metrics ──────────────────────────────────────────────────────────────── */

export async function getMetrics(candidateId: CandidateId): Promise<Metrics> {
  const row = plain<Row>(await getDb().prepare('SELECT * FROM metrics WHERE candidate_id = ?').get(candidateId));
  if (!row) return { ...EMPTY_METRICS };
  return {
    precision_index: Number(row.precision_index),
    reflex_latency_pct_of_baseline: Number(row.reflex_latency_pct_of_baseline),
    retention_density: Number(row.retention_density),
    vocal_clarity_delta: Number(row.vocal_clarity_delta),
    pattern_intuition: Number(row.pattern_intuition),
  };
}

export async function getMetricProvenance(candidateId: CandidateId): Promise<Record<string, unknown>> {
  const row = plain<Row>(await getDb().prepare('SELECT provenance FROM metrics WHERE candidate_id = ?').get(candidateId));
  return parseJson<Record<string, unknown>>(row?.provenance, { rd_provisional: true, sessions_in_rl_window: 0 });
}

export async function upsertMetrics(candidateId: CandidateId, m: Metrics, provenance: unknown): Promise<void> {
  await getDb()
    .prepare(
      `INSERT INTO metrics (candidate_id, precision_index, reflex_latency_pct_of_baseline,
                            retention_density, vocal_clarity_delta, pattern_intuition, provenance, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(candidate_id) DO UPDATE SET
         precision_index = excluded.precision_index,
         reflex_latency_pct_of_baseline = excluded.reflex_latency_pct_of_baseline,
         retention_density = excluded.retention_density,
         vocal_clarity_delta = excluded.vocal_clarity_delta,
         pattern_intuition = excluded.pattern_intuition,
         provenance = excluded.provenance,
         updated_at = excluded.updated_at`,
    )
    .run(
      candidateId,
      m.precision_index,
      m.reflex_latency_pct_of_baseline,
      m.retention_density,
      m.vocal_clarity_delta,
      m.pattern_intuition,
      JSON.stringify(provenance),
      nowIso(),
    );
  await getDb()
    .prepare('INSERT INTO metric_history (candidate_id, metrics, at) VALUES (?, ?, ?)')
    .run(candidateId, JSON.stringify(m), nowIso());
}

export async function metricHistory(candidateId: CandidateId, limit = 20): Promise<Partial<Metrics>[]> {
  const rows = plainAll<Row>(
    await getDb()
      .prepare('SELECT metrics FROM metric_history WHERE candidate_id = ? ORDER BY id DESC LIMIT ?')
      .all(candidateId, limit),
  );
  return rows.map((r) => parseJson<Partial<Metrics>>(r.metrics, {})).reverse();
}

export async function getFloors(candidateId: CandidateId): Promise<{ floors: MetricFloors; baseline: Metrics }> {
  const row = plain<Row>(
    await getDb().prepare('SELECT floors, capability_baseline FROM metric_floors WHERE candidate_id = ?').get(candidateId),
  );
  if (!row) {
    return {
      floors: { ...EMPTY_METRICS },
      baseline: { ...EMPTY_METRICS },
    };
  }
  return {
    floors: parseJson<MetricFloors>(row.floors, { ...EMPTY_METRICS }),
    baseline: parseJson<Metrics>(row.capability_baseline, { ...EMPTY_METRICS }),
  };
}

export async function upsertFloors(candidateId: CandidateId, floors: MetricFloors, baseline: Metrics): Promise<void> {
  await getDb()
    .prepare(
      `INSERT INTO metric_floors (candidate_id, floors, capability_baseline, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(candidate_id) DO UPDATE SET
         floors = excluded.floors,
         capability_baseline = excluded.capability_baseline,
         updated_at = excluded.updated_at`,
    )
    .run(candidateId, JSON.stringify(floors), JSON.stringify(baseline), nowIso());
}

/* ── Sessions ─────────────────────────────────────────────────────────────── */

export interface InsertSessionArgs {
  sessionId: string;
  candidateId: CandidateId;
  moduleId: ModuleId;
  blockId: string | null;
  sublevel: number;
  startedAt: string;
  endedAt: string;
  accuracyPct: number;
  meanLatencyMs: number;
  thresholdMs: number;
  speedMultiplier: number;
  errors: string[];
  ape: unknown;
  isDelayedRecall: boolean;
  recallOfSession: string | null;
  attempts: Attempt[];
  /** Item payloads retained for 24h re-presentation. */
  items: { item_id: string; payload: unknown }[];
}

export async function insertSession(a: InsertSessionArgs): Promise<void> {
  const charCorrect = a.attempts.reduce((s, x) => s + x.correct_chars, 0);
  const charTotal = a.attempts.reduce((s, x) => s + x.counted_chars, 0);
  await tx(async (d) => {
    await d
      .prepare(
        `INSERT INTO sessions
           (session_id, candidate_id, module_id, phase, block_id, sublevel, started_at, ended_at,
            accuracy_pct, mean_latency_ms, threshold_ms, speed_multiplier, char_correct, char_total,
            errors, ape, is_delayed_recall, recall_of_session)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        a.sessionId,
        a.candidateId,
        a.moduleId,
        MODULES[a.moduleId].phase,
        a.blockId,
        a.sublevel,
        a.startedAt,
        a.endedAt,
        a.accuracyPct,
        a.meanLatencyMs,
        a.thresholdMs,
        a.speedMultiplier,
        charCorrect,
        charTotal,
        JSON.stringify(a.errors),
        JSON.stringify(a.ape),
        a.isDelayedRecall ? 1 : 0,
        a.recallOfSession,
      );

    const attStmt = d.prepare(
      `INSERT INTO session_attempts
         (session_id, candidate_id, module_id, item_id, item_kind, position, correct, input, expected,
          latency_ms, error_code, error_category, char_position, latency_delta_ms, counted_chars,
          correct_chars, slot_category, delayed_recall, clarity_score)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    // Sequential, not forEach: each run is a round trip inside one transaction,
    // so an unawaited one would resolve after the commit and be lost.
    for (const [i, at] of a.attempts.entries()) {
      await attStmt.run(
        a.sessionId,
        a.candidateId,
        a.moduleId,
        at.item_id,
        at.item_kind,
        i,
        at.correct ? 1 : 0,
        at.input,
        at.expected,
        at.latency_ms,
        at.error_code,
        at.error_category,
        at.char_position,
        at.latency_delta_ms,
        at.counted_chars,
        at.correct_chars,
        at.slot_category ?? null,
        at.delayed_recall ? 1 : 0,
        at.clarity_score ?? null,
      );
    }

    const itemStmt = d.prepare(
      `INSERT INTO session_items (session_id, candidate_id, module_id, item_id, payload, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const it of a.items) {
      await itemStmt.run(a.sessionId, a.candidateId, a.moduleId, it.item_id, JSON.stringify(it.payload), nowIso());
    }
  });
}

export async function getSession(sessionId: string): Promise<Row | null> {
  return plain<Row>(await getDb().prepare('SELECT * FROM sessions WHERE session_id = ?').get(sessionId));
}

export async function listSessions(
  candidateId: CandidateId,
  limit = 50,
): Promise<{ session_id: string; module_id: string; sublevel: number; started_at: string; accuracy_pct: number; mean_latency_ms: number; threshold_ms: number }[]> {
  const rows = plainAll<Row>(
    await getDb()
      .prepare(
        `SELECT session_id, module_id, sublevel, started_at, accuracy_pct, mean_latency_ms, threshold_ms
         FROM sessions WHERE candidate_id = ? ORDER BY started_at DESC LIMIT ?`,
      )
      .all(candidateId, limit),
  );
  return rows.map((r) => ({
    session_id: r.session_id as string,
    module_id: r.module_id as string,
    sublevel: Number(r.sublevel),
    started_at: r.started_at as string,
    accuracy_pct: Number(r.accuracy_pct),
    mean_latency_ms: Number(r.mean_latency_ms),
    threshold_ms: Number(r.threshold_ms),
  }));
}

export async function phaseSessions(candidateId: CandidateId, phase: number, sinceMs: number): Promise<{ started_at: string; accuracy_pct: number }[]> {
  const rows = plainAll<Row>(
    await getDb()
      .prepare('SELECT started_at, accuracy_pct FROM sessions WHERE candidate_id = ? AND phase = ? AND started_at >= ?')
      .all(candidateId, phase, new Date(sinceMs).toISOString()),
  );
  return rows.map((r) => ({ started_at: r.started_at as string, accuracy_pct: Number(r.accuracy_pct) }));
}

export async function dailyAggregate(candidateId: CandidateId, date: string): Promise<{ aggregate_pct: number; sessions: number }> {
  const rows = plainAll<Row>(
    await getDb()
      .prepare(
        `SELECT accuracy_pct FROM sessions
         WHERE candidate_id = ? AND substr(started_at, 1, 10) = ?`,
      )
      .all(candidateId, date),
  );
  if (!rows.length) return { aggregate_pct: 0, sessions: 0 };
  const total = rows.reduce((s, r) => s + Number(r.accuracy_pct), 0);
  return { aggregate_pct: Math.round((total / rows.length) * 100) / 100, sessions: rows.length };
}

export async function modulesBelowBandToday(candidateId: CandidateId, date: string): Promise<ModuleId[]> {
  const rows = plainAll<Row>(
    await getDb()
      .prepare(
        `SELECT module_id, accuracy_pct FROM sessions
         WHERE candidate_id = ? AND substr(started_at, 1, 10) = ?`,
      )
      .all(candidateId, date),
  );
  const failed = new Set<ModuleId>();
  for (const r of rows) {
    const id = r.module_id as ModuleId;
    if (Number(r.accuracy_pct) < MODULES[id].target_band.min_pct) failed.add(id);
  }
  return [...failed];
}

/* ── Delayed recall sources (Section 3, RD weighting) ────────────────────── */

export async function delayedRecallCandidate(
  candidateId: CandidateId,
): Promise<{ session_id: string; payload: unknown; age_hours: number } | null> {
  const cutoff = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const rows = plainAll<Row>(
    await getDb()
      .prepare(
        `SELECT s.session_id, s.recall_of_session, si.payload, si.created_at
         FROM sessions s
         JOIN session_items si ON si.session_id = s.session_id
         WHERE s.candidate_id = ?
           AND s.module_id = 'P1_VSF'
           AND s.is_delayed_recall = 0
           AND s.started_at < ?
           AND s.session_id NOT IN (
             SELECT recall_of_session FROM sessions
             WHERE candidate_id = ? AND recall_of_session IS NOT NULL
           )
         ORDER BY s.started_at ASC
         LIMIT 1`,
      )
      .all(candidateId, cutoff, candidateId),
  );
  const row = rows[0];
  if (!row) return null;
  const ageH = (Date.now() - new Date(row.created_at as string).getTime()) / 3600000;
  return { session_id: row.session_id as string, payload: parseJson(row.payload, null), age_hours: Math.round(ageH * 100) / 100 };
}

/* ── Rolling windows ──────────────────────────────────────────────────────── */

export async function getWindow(candidateId: CandidateId, moduleId: ModuleId): Promise<RollingWindow> {
  const row = plain<Row>(
    await getDb()
      .prepare('SELECT window_json FROM rolling_windows WHERE candidate_id = ? AND module_id = ?')
      .get(candidateId, moduleId),
  );
  if (!row) return emptyWindow();
  return parseJson<RollingWindow>(row.window_json, emptyWindow());
}

export async function allWindows(candidateId: CandidateId): Promise<Record<string, RollingWindow>> {
  const rows = plainAll<Row>(
    await getDb().prepare('SELECT module_id, window_json FROM rolling_windows WHERE candidate_id = ?').all(candidateId),
  );
  const out: Record<string, RollingWindow> = {};
  for (const r of rows) out[r.module_id as string] = parseJson<RollingWindow>(r.window_json, emptyWindow());
  return out;
}

export async function saveWindow(candidateId: CandidateId, moduleId: ModuleId, window: RollingWindow): Promise<void> {
  await getDb()
    .prepare(
      `INSERT INTO rolling_windows (candidate_id, module_id, window_json, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(candidate_id, module_id) DO UPDATE SET
         window_json = excluded.window_json, updated_at = excluded.updated_at`,
    )
    .run(candidateId, moduleId, JSON.stringify(window), nowIso());
}

export function emptyWindow(): RollingWindow {
  return {
    last_8_sessions: [],
    current_threshold_ms: INITIAL_THRESHOLD,
    speed_multiplier: 1,
    adjustment_factor_log: [],
    sublevel: 1,
    consecutive_in_band: 0,
    escalation_ready: false,
    last_escalated_session_id: null,
  };
}

export async function initialiseWindows(
  candidateId: CandidateId,
  seed: number,
  sublevels: Record<string, number>,
): Promise<void> {
  for (const id of ALL_MODULE_IDS) {
    const w = emptyWindow();
    // Phase-gated modules start unlocked but keep a neutral window; the APE
    // never reads them until the phase unlocks.
    w.current_threshold_ms = seed;
    w.sublevel = sublevels[id] ?? 1;
    await saveWindow(candidateId, id, w);
  }
}

export async function sessionSummaries(candidateId: CandidateId, moduleId: ModuleId, limit = 8): Promise<SessionSummary[]> {
  const rows = plainAll<Row>(
    await getDb()
      .prepare(
        `SELECT session_id, started_at, module_id, sublevel, accuracy_pct, mean_latency_ms, errors
         FROM sessions WHERE candidate_id = ? AND module_id = ?
         ORDER BY started_at DESC LIMIT ?`,
      )
      .all(candidateId, moduleId, limit),
  );
  return rows
    .map((r) => ({
      session_id: r.session_id as string,
      started_at: r.started_at as string,
      module_id: r.module_id as ModuleId,
      sublevel: Number(r.sublevel),
      accuracy_pct: Number(r.accuracy_pct),
      mean_latency_ms: Number(r.mean_latency_ms),
      errors: parseJson<string[]>(r.errors, []),
    }))
    .reverse();
}

/* ── Error counters (Section 11: load-bearing) ────────────────────────────── */

export async function getErrorCounters(candidateId: CandidateId, moduleId: ModuleId): Promise<Record<string, number>> {
  const rows = plainAll<Row>(
    await getDb()
      .prepare('SELECT tag, sessions_flagged FROM error_counters WHERE candidate_id = ? AND module_id = ?')
      .all(candidateId, moduleId),
  );
  const out: Record<string, number> = {};
  for (const r of rows) out[r.tag as string] = Number(r.sessions_flagged);
  return out;
}

export async function saveErrorCounters(
  candidateId: CandidateId,
  moduleId: ModuleId,
  counters: Record<string, number>,
): Promise<void> {
  const stmt = await getDb().prepare(
    `INSERT INTO error_counters (candidate_id, module_id, tag, sessions_flagged, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(candidate_id, module_id, tag) DO UPDATE SET
       sessions_flagged = excluded.sessions_flagged, updated_at = excluded.updated_at`,
  );
  for (const [tag, n] of Object.entries(counters)) {
    if (n <= 0) continue;
    await stmt.run(candidateId, moduleId, tag, n, nowIso());
  }
}

export async function clearErrorCounter(candidateId: CandidateId, moduleId: ModuleId, tag: string): Promise<void> {
  await getDb()
    .prepare('DELETE FROM error_counters WHERE candidate_id = ? AND module_id = ? AND tag = ?')
    .run(candidateId, moduleId, tag);
}

/* ── Structural locks ─────────────────────────────────────────────────────── */

export async function insertLock(candidateId: CandidateId, lock: StructuralLock): Promise<void> {
  await getDb()
    .prepare(
      `INSERT INTO structural_locks
         (candidate_id, module_id, tag, sessions_flagged, remediation_active, triggered_at,
          cleared_at, sessions_remaining, diversion_pct, blocks_escalation)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      candidateId,
      lock.module_id,
      lock.tag,
      lock.sessions_flagged,
      lock.remediation_active ? 1 : 0,
      lock.triggered_at,
      lock.cleared_at,
      lock.sessions_remaining,
      lock.diversion_pct,
      lock.blocks_escalation ? 1 : 0,
    );
}

export async function clearLock(lockId: number, at: string): Promise<void> {
  await getDb()
    .prepare('UPDATE structural_locks SET remediation_active = 0, cleared_at = ? WHERE id = ?')
    .run(at, lockId);
}

export async function decrementLockSessions(lockId: number): Promise<void> {
  await getDb()
    // GREATEST, not MAX: SQLite's two-argument scalar max() has no Postgres
    // equivalent, where max() is a single-argument aggregate.
    .prepare('UPDATE structural_locks SET sessions_remaining = GREATEST(0, sessions_remaining - 1) WHERE id = ?')
    .run(lockId);
}

interface LockRow extends Row {
  id: number;
  module_id: string;
  tag: string;
  sessions_flagged: number;
  remediation_active: number;
  triggered_at: string;
  cleared_at: string | null;
  sessions_remaining: number;
  diversion_pct: number;
  blocks_escalation: number;
}

function toLock(r: LockRow): StructuralLock {
  return {
    tag: r.tag,
    module_id: r.module_id as ModuleId,
    sessions_flagged: Number(r.sessions_flagged),
    remediation_active: Number(r.remediation_active) === 1,
    triggered_at: r.triggered_at,
    sessions_remaining: Number(r.sessions_remaining),
    diversion_pct: Number(r.diversion_pct),
    cleared_at: r.cleared_at,
    blocks_escalation: Number(r.blocks_escalation) === 1,
  };
}

export async function activeLocks(candidateId: CandidateId): Promise<StructuralLock[]> {
  const rows = plainAll<Row>(
    await getDb()
      .prepare('SELECT * FROM structural_locks WHERE candidate_id = ? AND remediation_active = 1')
      .all(candidateId),
  );
  return (rows as LockRow[]).map(toLock);
}

export async function lockHistory(candidateId: CandidateId): Promise<StructuralLock[]> {
  const rows = plainAll<Row>(
    await getDb().prepare('SELECT * FROM structural_locks WHERE candidate_id = ?').all(candidateId),
  );
  return (rows as LockRow[]).map(toLock);
}

export async function activeLockRows(candidateId: CandidateId): Promise<LockRow[]> {
  const rows = plainAll<Row>(
    await getDb()
      .prepare('SELECT * FROM structural_locks WHERE candidate_id = ? AND remediation_active = 1')
      .all(candidateId),
  );
  return rows as LockRow[];
}

/* ── Streak & daily log ───────────────────────────────────────────────────── */

export async function getStreak(candidateId: CandidateId): Promise<{ current: number; multiplier: number; last_date: string | null; best: number }> {
  const r = plain<Row>(await getDb().prepare('SELECT * FROM streaks WHERE candidate_id = ?').get(candidateId));
  return {
    current: Number(r?.current ?? 0),
    multiplier: Number(r?.multiplier ?? 1),
    last_date: (r?.last_date as string | null) ?? null,
    best: Number(r?.best ?? 0),
  };
}

export async function saveStreak(candidateId: CandidateId, s: { current: number; multiplier: number; last_date: string | null; best: number }): Promise<void> {
  await getDb()
    .prepare(
      `INSERT INTO streaks (candidate_id, current, multiplier, last_date, best)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(candidate_id) DO UPDATE SET
         current = excluded.current, multiplier = excluded.multiplier,
         last_date = excluded.last_date, best = excluded.best`,
    )
    .run(candidateId, s.current, s.multiplier, s.last_date, s.best);
}

export async function insertDailyLog(entry: {
  candidateId: CandidateId;
  date: string;
  aggregatePct: number;
  tier: string;
  streakBefore: number;
  streakAfter: number;
  multiplierAfter: number;
  modulesFailed: ModuleId[];
  forcedRepeat: boolean;
}): Promise<void> {
  await getDb()
    .prepare(
      `INSERT INTO daily_log
         (candidate_id, date, aggregate_pct, tier, streak_before, streak_after, multiplier_after,
          modules_failed, forced_repeat, baseline_stats_cut, lockout_applied, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?)`,
    )
    .run(
      entry.candidateId,
      entry.date,
      entry.aggregatePct,
      entry.tier,
      entry.streakBefore,
      entry.streakAfter,
      entry.multiplierAfter,
      JSON.stringify(entry.modulesFailed),
      entry.forcedRepeat ? 1 : 0,
      nowIso(),
    );
}

/** Raw `daily_log` row. SQLite has no boolean type: flags come back as 0/1. */
export interface DailyLogRow extends Row {
  id: number;
  candidate_id: string;
  date: string;
  aggregate_pct: number;
  tier: string;
  streak_before: number;
  streak_after: number;
  multiplier_after: number;
  modules_failed: string;
  forced_repeat: number;
  baseline_stats_cut: number;
  lockout_applied: number;
  recorded_at: string;
}

export async function dailyLog(candidateId: CandidateId, limit = 30): Promise<DailyLogRow[]> {
  return plainAll(
    await getDb()
      .prepare('SELECT * FROM daily_log WHERE candidate_id = ? ORDER BY id DESC LIMIT ?')
      .all(candidateId, limit),
  ) as DailyLogRow[];
}

export async function dailyLogExists(candidateId: CandidateId, date: string): Promise<boolean> {
  const r = await getDb()
    .prepare('SELECT 1 AS ok FROM daily_log WHERE candidate_id = ? AND date = ?')
    .get(candidateId, date);
  return r !== undefined && r !== null;
}

/* ── Rank history & pending remediation ───────────────────────────────────── */

export async function currentRank(candidateId: CandidateId): Promise<Rank> {
  const r = plain<Row>(
    await getDb()
      .prepare('SELECT rank FROM rank_history WHERE candidate_id = ? ORDER BY id DESC LIMIT 1')
      .get(candidateId),
  );
  return (r?.rank as Rank | undefined) ?? 'RANK 03: DECODER';
}

export async function insertRank(candidateId: CandidateId, rank: Rank): Promise<void> {
  await getDb()
    .prepare('INSERT INTO rank_history (candidate_id, rank, at) VALUES (?, ?, ?)')
    .run(candidateId, rank, nowIso());
}

export async function rankHistory(candidateId: CandidateId): Promise<{ rank: Rank; at: string }[]> {
  const rows = plainAll<Row>(
    await getDb().prepare('SELECT rank, at FROM rank_history WHERE candidate_id = ? ORDER BY id').all(candidateId),
  );
  return rows.map((r) => ({ rank: r.rank as Rank, at: r.at as string }));
}

export async function addPendingRemediation(
  candidateId: CandidateId,
  moduleId: ModuleId,
  sourceSession: string | null,
  reason: string,
): Promise<void> {
  await getDb()
    .prepare(
      `INSERT INTO pending_remediation (candidate_id, module_id, scheduled_at, source_session, reason)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(candidateId, moduleId, nowIso(), sourceSession, reason);
}

export async function openRemediations(candidateId: CandidateId): Promise<ModuleId[]> {
  const rows = plainAll<Row>(
    await getDb()
      .prepare(
        'SELECT DISTINCT module_id FROM pending_remediation WHERE candidate_id = ? AND completed_at IS NULL',
      )
      .all(candidateId),
  );
  return rows.map((r) => r.module_id as ModuleId);
}

export async function completeRemediations(candidateId: CandidateId, moduleId: ModuleId): Promise<void> {
  await getDb()
    .prepare(
      `UPDATE pending_remediation SET completed_at = ?
       WHERE candidate_id = ? AND module_id = ? AND completed_at IS NULL`,
    )
    .run(nowIso(), candidateId, moduleId);
}

/* ── Rolling-window metric aggregation (Section 3) ────────────────────────── */

export interface SessionAttemptGroup {
  session_id: string;
  started_at: string;
  module_id: ModuleId;
  accuracy_pct: number;
  attempts: Attempt[];
}

export async function recentAttemptGroups(candidateId: CandidateId, limit = 8): Promise<SessionAttemptGroup[]> {
  const sessions = plainAll<Row>(
    await getDb()
      .prepare(
        `SELECT session_id, started_at, module_id, accuracy_pct
         FROM sessions WHERE candidate_id = ? ORDER BY started_at DESC LIMIT ?`,
      )
      .all(candidateId, limit),
  );
  if (!sessions.length) return [];
  const stmt = await getDb().prepare(
    `SELECT item_id, item_kind, correct, input, expected, latency_ms, error_code, error_category,
            char_position, latency_delta_ms, counted_chars, correct_chars, slot_category,
            delayed_recall, clarity_score
     FROM session_attempts WHERE session_id = ? ORDER BY position`,
  );
  return (
    await Promise.all(
      sessions.map(async (s) => {
        const rows = plainAll<Row>(await stmt.all(s.session_id as string));
        return {
          session_id: s.session_id as string,
          started_at: s.started_at as string,
          module_id: s.module_id as ModuleId,
          accuracy_pct: Number(s.accuracy_pct),
          attempts: rows.map(
            (r): Attempt => ({
              item_id: r.item_id as string,
              item_kind: r.item_kind as string,
              correct: Number(r.correct) === 1,
              input: (r.input as string | null) ?? null,
              expected: (r.expected as string | null) ?? null,
              latency_ms: Number(r.latency_ms),
              error_code: r.error_code as Attempt['error_code'],
              error_category: (r.error_category as string | null) ?? null,
              char_position: r.char_position === null ? null : Number(r.char_position),
              latency_delta_ms: r.latency_delta_ms === null ? null : Number(r.latency_delta_ms),
              counted_chars: Number(r.counted_chars),
              correct_chars: Number(r.correct_chars),
              slot_category: (r.slot_category as string | null) ?? null,
              delayed_recall: Number(r.delayed_recall) === 1,
              clarity_score: r.clarity_score === null ? null : Number(r.clarity_score),
            }),
          ),
        };
      }),
    )
  ).reverse();
}

export async function bootstrapCandidate(
  candidateId: CandidateId,
  floors: MetricFloors,
  seedMetrics: Metrics,
): Promise<void> {
  await tx(async () => {
    await upsertMetrics(candidateId, seedMetrics, { rd_provisional: true, sessions_in_rl_window: 0, updated_at: nowIso() });
    await upsertFloors(candidateId, floors, seedMetrics);
    await saveStreak(candidateId, { current: 0, multiplier: 1, last_date: null, best: 0 });
    await insertRank(candidateId, 'RANK 03: DECODER');
  });
}

export { roundMetric };
