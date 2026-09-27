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
import type { CandidateId, ModuleId, Pcp, RollingWindow, VocabularyBand } from '../core/types.js';
import { CALIBRATION_PRESSURE, calibrationProbeWindow } from '../core/calibration.js';
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
  /**
   * Calibration only. The battery runs every vector twice, and the timed pass is
   * supposed to be the same content under pressure. It previously had no effect:
   * `probePcp` ignored it, so both passes returned byte-identical plans at the
   * same WPM and the same threshold. That silently voided the two measurements
   * the engine derives from the contrast — C3's "WPM where accuracy drops below
   * 90%" had a single speed to measure, and C5's typo vulnerability index was
   * structurally 0, which reads as maximum orthographic strength.
   */
  passType?: PassType;
}

export interface PlanResult {
  plan: ReturnType<typeof buildSession>;
  recall_of_session: string | null;
  recall_payload: { kind: 'scene'; scene_id: string; slots: { slot: number; expected: string }[] }[];
}

export type PassType = 'untimed' | 'timed';

/**
 * A neutral, never-persisted profile used only to generate battery items. The
 * real PCP is derived from the recorded passes by derivePcp; nothing scored
 * against a probe ever reaches a metric, threshold, or rank.
 *
 * The seed varies with `passType` so the two passes are genuinely different
 * measurements. Everything else stays neutral.
 */
export function probePcp(candidateId: CandidateId, passType: PassType = 'untimed'): Pcp {
  const pressure = CALIBRATION_PRESSURE[passType];
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
      latency_threshold_ms: calibrationProbeWindow(passType),
      wpm_ceiling: pressure.wpm_ceiling,
      flash_duration_ms: 120,
      phase1_sublevel: { P1_VD: 1, P1_VSF: 1, P1_VM: 1 },
      speed_multiplier: 1,
    },
    vectors: [],
    locked: false,
  };
}

/**
 * The response window a pass is actually built from.
 *
 * A calibration pass takes its window from the probe profile rather than from a
 * rolling window. buildSession reads `window.current_threshold_ms`, and a
 * candidate who has never trained carries the INITIAL_THRESHOLD default — which
 * is also the probe's *untimed* value. So the timed pass's 0.6 factor was
 * computed and then discarded, and C3 through C5 served identical configuration
 * on both passes. C4 and C5 measure a timed-versus-untimed contrast, so identical
 * plans meant the contrast was measuring nothing at all.
 *
 * A candidate's live windows are deliberately not consulted for a probe: those
 * encode the track the new baseline is meant to replace, for the same reason the
 * probe does not reuse their PCP.
 */
export function windowForPass(window: RollingWindow, pcp: Pcp, gated: boolean): RollingWindow {
  return gated ? window : { ...window, current_threshold_ms: pcp.phase_1_entry_difficulty_seed.latency_threshold_ms };
}

export async function planFor(
  candidateId: CandidateId,
  moduleId: ModuleId,
  options: PlanOptions,
): Promise<PlanResult> {
  if (!ALL_MODULE_IDS.includes(moduleId)) throw new HttpError(400, 'unknown module');
  const descriptor = MODULES[moduleId];

  // An ungated plan always uses the neutral probe profile, never a stored PCP.
  // Falling back to the candidate's real PCP made the two calibration passes
  // identical for anyone recalibrating, and would have measured the new
  // baseline against the old one it is meant to replace.
  const pcp = options.gated
    ? await requirePcp(candidateId)
    : probePcp(candidateId, options.passType ?? 'untimed');

  if (options.gated) {
    const rank = await currentRank(candidateId);
    const needed = PHASE_UNLOCK_RANK[descriptor.phase];
    if (needed !== null && !rankAtLeast(rank, needed)) {
      throw new HttpError(423, `PHASE ${descriptor.phase} LOCKED — requires ${needed}`);
    }
  }

  const windows = await allWindows(candidateId);
  const window = windows[moduleId] ?? (await getWindow(candidateId, moduleId)) ?? emptyWindow();
  // A calibration pass takes its response window from the probe profile, not
  // from a rolling window — see windowForPass for why that distinction decides
  // whether the timed pass is a real measurement.
  const effectiveWindow = windowForPass(window, pcp, options.gated === true);
  const locks = await activeLocks(candidateId);
  const sessionIndex = (await sessionSummaries(candidateId, moduleId, 50)).length + 1;

  // 24h re-presentation for RD, P1_VSF only. A probe never re-presents a scene.
  let delayed: DelayedScenePayload | null = null;
  let recallOf: string | null = null;
  if (options.gated && moduleId === 'P1_VSF') {
    const cand = await delayedRecallCandidate(candidateId);
    if (cand && cand.payload && cand.age_hours >= 24) {
      delayed = cand.payload as DelayedScenePayload;
      recallOf = cand.session_id;
    }
  }

  const plan = buildSession(moduleId, {
    candidate_id: candidateId,
    pcp,
    window: effectiveWindow,
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
