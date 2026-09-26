import { ALL_MODULE_IDS, MODULES, PHASE_UNLOCK_RANK, rankAtLeast } from '../core/modules.js';
import { buildSession, type DelayedScenePayload } from '../content/index.js';
import { requirePcp } from './calibrationService.js';
import { HttpError } from './httpError.js';
import {
  activeLocks,
  allWindows,
  currentRank,
  delayedRecallCandidate,
  getPcp,
  getWindow,
  sessionSummaries,
} from '../db/repo.js';
import type { CandidateId, ModuleId, Pcp, VocabularyBand } from '../core/types.js';
import { emptyWindow } from '../db/repo.js';

/**
 * One place that turns a candidate id plus a module id into a session plan, so
 * the authenticated user-scoped routes and the legacy `/candidates/:id/...`
 * routes cannot drift apart.
 */

export interface PlanOptions {
  /**
   * Drill plans are unreachable without a completed PCP (Section 11 hard gate).
   * Calibration probe plans are explicitly exempt: the battery has to run
   * BEFORE a PCP exists, which is the whole point of calibrating.
   */
  gated: boolean;
}

export interface PlanResult {
  plan: ReturnType<typeof buildSession>;
  recall_of_session: string | null;
  recall_payload: { kind: 'scene'; scene_id: string; slots: { slot: number; expected: string }[] }[];
}

/**
 * A neutral, never-persisted profile used only to generate battery items. The
 * real PCP is derived from the recorded passes by derivePcp; nothing scored
 * against a probe ever reaches a metric, threshold, or rank.
 */
function probePcp(candidateId: CandidateId): Pcp {
  return {
    candidate_id: candidateId,
    calibration_date: '',
    vocabulary_band: 'V6' as VocabularyBand,
    syntax_ceiling: 'S5',
    baseline_reflex_latency_ms: 1200,
    baseline_vocal_clarity: 50,
    typo_vulnerability_index: 0.5,
    flagged_weak_vectors: [],
    entry_rank: 'RANK 03: DECODER',
    phase_1_entry_difficulty_seed: {
      latency_threshold_ms: 1200,
      wpm_ceiling: 200,
      flash_duration_ms: 120,
      phase1_sublevel: { P1_VD: 1, P1_VSF: 1, P1_VM: 1 },
      speed_multiplier: 1,
    },
    vectors: [],
    locked: false,
  };
}

export function planFor(candidateId: CandidateId, moduleId: ModuleId, options: PlanOptions): PlanResult {
  if (!ALL_MODULE_IDS.includes(moduleId)) throw new HttpError(400, 'unknown module');
  const descriptor = MODULES[moduleId];

  const pcp = options.gated ? requirePcp(candidateId) : getPcp(candidateId) ?? probePcp(candidateId);

  if (options.gated) {
    const rank = currentRank(candidateId);
    const needed = PHASE_UNLOCK_RANK[descriptor.phase];
    if (needed !== null && !rankAtLeast(rank, needed)) {
      throw new HttpError(423, `PHASE ${descriptor.phase} LOCKED — requires ${needed}`);
    }
  }

  const windows = allWindows(candidateId);
  const window = windows[moduleId] ?? getWindow(candidateId, moduleId) ?? emptyWindow();
  const locks = activeLocks(candidateId);
  const sessionIndex = sessionSummaries(candidateId, moduleId, 50).length + 1;

  // 24h re-presentation for RD, P1_VSF only. A probe never re-presents a scene.
  let delayed: DelayedScenePayload | null = null;
  let recallOf: string | null = null;
  if (options.gated && moduleId === 'P1_VSF') {
    const cand = delayedRecallCandidate(candidateId);
    if (cand && cand.payload && cand.age_hours >= 24) {
      delayed = cand.payload as DelayedScenePayload;
      recallOf = cand.session_id;
    }
  }

  const plan = buildSession(moduleId, {
    candidate_id: candidateId,
    pcp,
    window,
    locks,
    session_index: sessionIndex,
    delayed_scene: delayed,
  });

  /* The client echoes these back on submit so the server can retain the scene
     for its 24h re-presentation. */
  const recallPayload = plan.items
    .filter((i): i is Extract<typeof i, { kind: 'scene' }> => i.kind === 'scene')
    .filter((i) => !i.delayed_recall)
    .map((i) => ({
      kind: 'scene' as const,
      scene_id: i.scene_id,
      slots: i.slots.map((s) => ({ slot: s.slot, expected: s.expected })),
    }));

  return { plan, recall_of_session: recallOf, recall_payload: recallPayload };
}
