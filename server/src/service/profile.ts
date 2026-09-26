import type { CandidateId, CandidateProfile, ModuleId, Phase, Rank } from '../core/types.js';
import type { DailyLogRow } from '../db/repo.js';
import {
  activeLocks,
  allWindows,
  candidateName,
  currentRank,
  dailyLog,
  getFloors,
  getMetricProvenance,
  getMetrics,
  getPcp,
  getStreak,
  lockHistory,
  openRemediations,
  rankHistory,
} from '../db/repo.js';
import { MODULES, PHASE_UNLOCK_RANK, rankAtLeast } from '../core/modules.js';
import { evaluateRanks } from '../core/ranks.js';
import { phaseSessions } from '../db/repo.js';
import { MASTER_WINDOW_DAYS } from '../core/ranks.js';
import { ALL_MODULE_IDS } from '../core/modules.js';
import { todayUtc } from '../util.js';

export function buildCandidateProfile(candidateId: CandidateId): CandidateProfile | null {
  const pcp = getPcp(candidateId);
  const rank = currentRank(candidateId);
  const windows = allWindows(candidateId);
  const locks = activeLocks(candidateId);
  const history = lockHistory(candidateId);
  const { floors } = getFloors(candidateId);

  const phaseUnlocked = {} as Record<Phase, boolean>;
  for (const phase of [1, 2, 3, 4] as Phase[]) {
    const req = PHASE_UNLOCK_RANK[phase];
    phaseUnlocked[phase] = req === null || rankAtLeast(rank, req);
  }

  const phase4 = phaseSessions(candidateId, 4, Date.now() - MASTER_WINDOW_DAYS * 86400000);
  const evalResult = evaluateRanks({
    rank,
    rolling_windows: windows,
    locks,
    lock_history: history,
    phase4_sessions: phase4,
    now: new Date(),
  });

  return {
    candidate_id: candidateId,
    display_name: candidateName(candidateId) ?? candidateId,
    created_at: nowOf(candidateId),
    pcp,
    current_rank: rank,
    metrics: getMetrics(candidateId),
    metric_floors: floors,
    metric_provenance: getMetricProvenance(candidateId) as unknown as CandidateProfile['metric_provenance'],
    active_structural_locks: locks,
    rolling_windows: windows,
    streak: getStreak(candidateId),
    daily_log: dailyLog(candidateId, 30).map(mapDailyLogEntry),
    rank_history: rankHistory(candidateId),
    pending_remediation: openRemediations(candidateId),
    phase_unlocked: phaseUnlocked,
    master_window: evalResult.master_stats,
  };
}

/** Normalise a raw daily_log row into the camelCase DTO the UI consumes. */
function mapDailyLogEntry(r: DailyLogRow): CandidateProfile['daily_log'][number] {
  return {
    date: r.date,
    aggregate_pct: r.aggregate_pct,
    tier: r.tier as CandidateProfile['daily_log'][number]['tier'],
    streak_before: r.streak_before,
    streak_after: r.streak_after,
    multiplier_after: r.multiplier_after,
    modules_failed: r.modules_failed === '' ? [] : (r.modules_failed.split(',') as ModuleId[]),
    forced_repeat: r.forced_repeat === 1,
    baseline_stats_cut: r.baseline_stats_cut === 1,
    lockout_applied: r.lockout_applied === 1,
  };
}

function nowOf(candidateId: string): string {
  void candidateId;
  return todayUtc();
}

/** Modules the candidate may run right now, honouring rank and forced repeats. */
export function availableModules(profile: CandidateProfile): { module_id: string; unlocked: boolean; reason: string }[] {
  const pending = new Set(profile.pending_remediation);
  return ALL_MODULE_IDS.map((id) => {
    const phase = MODULES[id].phase;
    const unlocked = profile.phase_unlocked[phase];
    let reason: string;
    if (unlocked) {
      reason = pending.has(id) ? 'FORCED REPEAT — run required' : 'available';
    } else {
      const req = PHASE_UNLOCK_RANK[phase] as Rank;
      reason = `locked until ${req}`;
    }
    return { module_id: id, unlocked, reason };
  });
}

export interface RankStatus {
  current: Rank;
  next: Rank | null;
  requirements: ReturnType<typeof evaluateRanks>['requirements'];
}

export function rankStatus(profile: CandidateProfile): RankStatus {
  const evalResult = evaluateRanks({
    rank: profile.current_rank,
    rolling_windows: profile.rolling_windows,
    locks: profile.active_structural_locks,
    lock_history: [],
    phase4_sessions: [],
    now: new Date(),
  });
  return { current: profile.current_rank, next: evalResult.nextRank, requirements: evalResult.requirements };
}
