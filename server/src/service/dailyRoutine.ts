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
import { emptyWindow, allWindows, activeLocks, currentRank } from '../db/repo.js';
import { requirePcp } from './calibrationService.js';
import { HttpError } from './httpError.js';
import type { BlockId, CandidateId, ModuleId, Rank, RollingWindow } from '../core/types.js';

/**
 * One module inside a block, and why it is in today's routine.
 *
 * A block is a time budget that binds *several* modules, not one. VECTOR holds
 * P1_VD and P3_SSM, VISUOSPATIAL holds P1_VSF and P2_FCM, DICTATION holds
 * P2_RDI, P3_HVS and P4_PC. Binding only one per block would silently skip the
 * rest every day and let a strong module starve a weak one indefinitely.
 */
export interface RoutineModule {
  /** Position within this block, 1-based. */
  order: number;
  module_id: ModuleId;
  /** Why this module is in the routine today. Not surfaced as a choice. */
  selection_reason: string;
  /** True when an open Structural Lock put this module at the front. */
  lock_driven: boolean;
}

/** One step of the routine: a block, its minutes, and the modules filling it. */
export interface RoutineStep {
  /** Position in the fixed daily order, 1-based. */
  order: number;
  block: BlockId;
  block_title: string;
  minutes: number;
  modules: RoutineModule[];
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
 * Orders every eligible module in a block, worst first.
 *
 * Priority is: an open Structural Lock, then weakness-first (lowest rolling
 * accuracy), then a date-seeded rotation that only reorders genuine ties — so a
 * block whose modules are truly tied still varies day to day without the
 * routine becoming unpredictable for a candidate who has no signal yet.
 *
 * Every eligible module is returned. Ordering is what weakness-first controls;
 * dropping modules is not on the table.
 */
function orderBlock(
  block: BlockId,
  candidates: ModuleId[],
  locks: { module_id: ModuleId; remediation_active: boolean }[],
  weakness: Map<ModuleId, number>,
  date: string,
): ModuleId[] {
  const inBlock = candidates.filter((m) => MODULES[m].block === block);
  if (inBlock.length === 0) return [];

  const isLocked = (m: ModuleId) => locks.some((l) => l.module_id === m && l.remediation_active);

  // 1. Open locks lead their block, strongest lock reason first.
  const locked = inBlock.filter(isLocked);
  const unlocked = inBlock.filter((m) => !isLocked(m));

  // 2. Weakest first. Module id breaks ties deterministically before the
  //    rotation gets a say, so the result never depends on registry order.
  unlocked.sort((a, b) => (weakness.get(a) ?? 1) - (weakness.get(b) ?? 1) || a.localeCompare(b));

  // 3. Date-seeded rotation, applied only within exact-tie runs. `date` is the
  //    seed, so the order is stable within a day and varies across days.
  const seed = [...date].reduce((a, c) => a + c.charCodeAt(0), 0);
  for (let i = 0; i < unlocked.length; ) {
    const base = weakness.get(unlocked[i]!) ?? 1;
    let end = i + 1;
    while (end < unlocked.length && Math.abs((weakness.get(unlocked[end]!) ?? 1) - base) < 1e-9) end += 1;
    const runLength = end - i;
    if (runLength > 1) {
      const offset = seed % runLength;
      const run = unlocked.slice(i, end);
      unlocked.splice(i, runLength, ...run.slice(offset), ...run.slice(0, offset));
    }
    i = end;
  }

  return [...locked, ...unlocked];
}


function reasonFor(
  moduleId: ModuleId,
  locks: { module_id: ModuleId; remediation_active: boolean }[],
): string {
  if (locks.some((l) => l.module_id === moduleId && l.remediation_active)) {
    return `open Structural Lock on ${moduleId}`;
  }
  return `weakness-first selection among ${MODULES[moduleId].block} candidates`;
}

/**
 * Builds the routine for a candidate. Throws 423 when no PCP exists, so a caller
 * cannot reach routine content ahead of calibration.
 *
 * This is the only part that touches the database. The decision itself lives in
 * `assembleRoutine`, which is pure, so the selection priorities can be tested
 * without a live DB — the priorities are the part that matters and the part that
 * was never executed before this split existed.
 */
export async function buildDailyRoutine(candidateId: CandidateId, date: string): Promise<DailyRoutine> {
  await requirePcp(candidateId);
  const [rank, locks, windows] = await Promise.all([
    currentRank(candidateId),
    activeLocks(candidateId),
    allWindows(candidateId),
  ]);
  return assembleRoutine({ candidateId, date, rank, locks, windows });
}

/** Everything the routine decision needs, read once and passed in. */
export interface RoutineInputs {
  candidateId: CandidateId;
  date: string;
  rank: Rank;
  locks: { module_id: ModuleId; remediation_active: boolean }[];
  windows: Record<string, RollingWindow>;
}

/** The pure core: rank, locks and rolling windows in, one routine out. */
export function assembleRoutine(inputs: RoutineInputs): DailyRoutine {
  const { candidateId, date, rank, locks, windows } = inputs;
  const eligible = eligibleModules(rank);

  // Weakness score: LOWER IS WEAKER, so ordering ascending puts the weakest first.
  // Derived from the rolling 8-session window (Section 2.4), not a separate
  // accuracy column, so it uses exactly the same evidence the APE already
  // trusts. The score is the mean accuracy as a fraction, which also makes the
  // no-evidence value below (0.5) sit naturally where a 50% candidate would.
  const weakness = new Map<ModuleId, number>();
  for (const m of eligible) {
    const sessions = (windows[m] ?? emptyWindow()).last_8_sessions;
    if (sessions.length === 0) {
      // Neutral, not maximally weak: novelty alone must never pull an untested
      // module in ahead of one the candidate is actually failing.
      weakness.set(m, 0.5);
      continue;
    }
    const mean = sessions.reduce((a, s) => a + s.accuracy_pct, 0) / sessions.length;
    weakness.set(m, mean / 100);
  }

  const steps: RoutineStep[] = [];
  const emptyBlocks: { block: BlockId; reason: string }[] = [];
  let order = 0;

  for (const b of BASE_BLOCK_MINUTES) {
    // LOGGING is system-only: metric writes, APE/Glicko update, remediation queue.
    // It is not a module and must never be turned into one.
    if (b.block === 'LOGGING') continue;

    const ordered = orderBlock(b.block, eligible, locks, weakness, date);
    if (ordered.length === 0) {
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
      minutes: b.minutes,
      modules: ordered.map((moduleId, i) => ({
        order: i + 1,
        module_id: moduleId,
        selection_reason: reasonFor(moduleId, locks),
        lock_driven: locks.some((l) => l.module_id === moduleId && l.remediation_active),
      })),
    });
  }

  return { candidate_id: candidateId, date, rank, steps, empty_blocks: emptyBlocks };
}

/**
 * Resolves a client-supplied position to a module inside the routine.
 *
 * The client may say *which* module in the block it is completing, but it may
 * not say *which* modules exist, nor add, drop or reorder any of them. That is
 * the difference that matters for Section 16.1: naming a module is selection,
 * counting through a list the server already decided is not. Both values are
 * validated against the routine, so an out-of-range index is refused rather
 * than clamped.
 */
export function resolveStepModule(
  routine: DailyRoutine,
  stepOrder: number,
  moduleOrder: number,
): { step: RoutineStep; module: RoutineModule } {
  const step = routine.steps.find((s) => s.order === stepOrder);
  if (!step) {
    throw new HttpError(
      400,
      `no routine step ${stepOrder} — today's routine has ${routine.steps.length} step(s). ` +
        'The server decides the routine; a client cannot request a module by name.',
    );
  }
  const module = step.modules.find((m) => m.order === moduleOrder);
  if (!module) {
    throw new HttpError(
      400,
      `step ${stepOrder} (${step.block}) has ${step.modules.length} module(s); no module at position ${moduleOrder}. ` +
        'The module list for a block is fixed by the server.',
    );
  }
  return { step, module };
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
