/**
 * Section 16.3 — the one daily routine.
 *
 * This is a binding layer, not a new scheduling system. Section 6 already
 * decides how many minutes each block gets and which blocks a Structural Lock
 * extends; that is unchanged. What this adds is the *content binding*: for each
 * block, which of the eligible modules actually run today, and in what order.
 *
 * The shape is identical every day — VOCAL, VECTOR, DICTATION, VISUOSPATIAL,
 * LOGGING — because the fixed shape is what builds instinct. What changes
 * invisibly is which items populate each block, driven by weakness-first
 * selection and per-module Glicko difficulty. The candidate never selects a
 * module; there is exactly one routine and the server decides all of it.
 */
import { ALL_MODULE_IDS, BASE_BLOCK_MINUTES, MODULES, PHASE_UNLOCK_RANK, rankAtLeast } from '../core/modules.js';
import { emptyWindow, allWindows, activeLocks, currentRank, getPcp, sessionSummaries } from '../db/repo.js';
import { requirePcp } from './calibrationService.js';
import { HttpError } from './httpError.js';
import type { BlockId, CandidateId, ModuleId, Pcp, Rank } from '../core/types.js';

/** One step of the routine: a block, the module serving it, and why. */
export interface RoutineStep {
  /** Position in the fixed daily order, 1-based. */
  order: number;
  block: BlockId;
  block_title: string;
  module_id: ModuleId;
  /** Why this module was chosen for this block today. Never shown to candidates. */
  selection_reason: string;
  /** True when an open Structural Lock put this block at the front of its block. */
  lock_driven: boolean;
}

export interface DailyRoutine {
  candidate_id: CandidateId;
  date: string;
  rank: string;
  steps: RoutineStep[];
  /** Blocks that exist in the fixed shape but have no eligible module yet. */
  empty_blocks: { block: BlockId; reason: string }[];
}

function eligibleModules(rank: Rank): ModuleId[] {
  return ALL_MODULE_IDS.filter((id) => {
    const needed = PHASE_UNLOCK_RANK[MODULES[id].phase];
    return needed === null || rankAtLeast(rank, needed);
  });
}

/**
 * Picks the module for one block.
 *
 * Priority is: an open Structural Lock, then weakness-first (lowest rolling
 * accuracy / most open remediation), then a stable rotation so that a block with
 * several eligible modules does not silently collapse onto one of them forever.
 * The rotation seed is the date, which is why the shape stays fixed but the
 * contents still vary day to day.
 */
function chooseForBlock(
  block: BlockId,
  candidates: ModuleId[],
  locks: { module_id: ModuleId; remediation_active: boolean }[],
  weakness: Map<ModuleId, number>,
  date: string,
): ModuleId | null {
  if (candidates.length === 0) return null;

  const inBlock = candidates.filter((m) => MODULES[m].block === block);
  if (inBlock.length === 0) return null;

  // 1. An open Structural Lock always wins its block.
  const locked = inBlock.find((m) => locks.some((l) => l.module_id === m && l.remediation_active));
  if (locked) return locked;

  // 2. Weakest first. Ties break on module id so the choice is deterministic.
  const weakest = [...inBlock].sort((a, b) => (weakness.get(a) ?? 1) - (weakness.get(b) ?? 1) || a.localeCompare(b))[0]!;

  // 3. Date-seeded rotation only when weakness is genuinely tied, so the
  //    routine does not become unpredictable for a candidate with no signal yet.
  const tied = inBlock.filter((m) => Math.abs((weakness.get(m) ?? 1) - (weakness.get(weakest) ?? 1)) < 1e-9);
  if (tied.length < 2) return weakest;

  const seed = [...date].reduce((a, c) => a + c.charCodeAt(0), 0);
  return tied[seed % tied.length]!;
}

function reasonFor(
  moduleId: ModuleId,
  locks: { module_id: ModuleId; remediation_active: boolean }[],
  chosen: ModuleId,
): string {
  if (locks.some((l) => l.module_id === moduleId && l.remediation_active)) {
    return `open Structural Lock on ${moduleId}`;
  }
  return moduleId === chosen ? `weakness-first selection among ${MODULES[moduleId].block} candidates` : '';
}

/**
 * Builds the routine for a candidate. Throws 423 when no PCP exists, so a caller
 * cannot reach routine content ahead of calibration.
 */
export async function buildDailyRoutine(candidateId: CandidateId, date: string): Promise<DailyRoutine> {
  const pcp: Pcp = await requirePcp(candidateId);
  const rank = await currentRank(candidateId);
  const locks = await activeLocks(candidateId);
  const windows = await allWindows(candidateId);
  const eligible = eligibleModules(rank);

  // Weakness score: lower is weaker. Derived from the rolling 8-session window
  // (Section 2.4), not a separate accuracy column, so it uses exactly the same
  // evidence the APE already trusts. A module with no sessions reads as neutral
  // rather than maximally weak, so novelty alone never pulls it in.
  const weakness = new Map<ModuleId, number>();
  for (const m of eligible) {
    const sessions = (windows[m] ?? emptyWindow()).last_8_sessions;
    if (sessions.length === 0) {
      weakness.set(m, 0.5);
      continue;
    }
    const mean = sessions.reduce((a, s) => a + s.accuracy_pct, 0) / sessions.length;
    weakness.set(m, 1.0 - mean / 100);
  }

  const steps: RoutineStep[] = [];
  const emptyBlocks: { block: BlockId; reason: string }[] = [];
  let order = 0;

  for (const b of BASE_BLOCK_MINUTES) {
    // LOGGING is system-only: metric writes, APE/Glicko update, remediation queue.
    // It is not a module and must never be turned into one.
    if (b.block === 'LOGGING') continue;

    const chosen = chooseForBlock(b.block, eligible, locks, weakness, date);
    if (!chosen) {
      emptyBlocks.push({
        block: b.block,
        reason: 'no module in this block is unlocked at the current rank',
      });
      continue;
    }
    order += 1;
    steps.push({
      order,
      block: b.block,
      block_title: b.title,
      module_id: chosen,
      selection_reason: reasonFor(chosen, locks, chosen),
      lock_driven: locks.some((l) => l.module_id === chosen && l.remediation_active),
    });
  }

  return { candidate_id: candidateId, date, rank, steps, empty_blocks: emptyBlocks };
}

/**
 * Section 16.1: a client-supplied module is not a legitimate input to either
 * drill endpoint. Rejecting is safer than silently ignoring, because a silent
 * ignore would let a client believe it had selected a module while silently
 * receiving a different one — and would leave the bypass in place for any future
 * caller that reads the response.
 */
export function rejectModuleParam(value: unknown): void {
  if (value === undefined) return;
  throw new HttpError(
    400,
    'MODULE SELECTION REMOVED - this endpoint serves the one daily routine. ' +
      'Naming a module is no longer accepted here, as a query parameter or in the body (Section 16.1).',
  );
}

/** How many sessions a candidate has run for a module, used to index plans. */
export async function sessionIndexFor(candidateId: CandidateId, moduleId: ModuleId): Promise<number> {
  return (await sessionSummaries(candidateId, moduleId, 50)).length + 1;
}

export { getPcp };
