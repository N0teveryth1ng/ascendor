import type { BlockAllocation, BlockId, DailySchedule, ModuleId, StructuralLock } from './types.js';
import { BASE_BLOCK_MINUTES, MODULES } from './modules.js';

/* ── Section 6: APE-weighted daily block structure ────────────────────────── */

export const TOTAL_BLOCK_S = 45 * 60;
export const MAX_ADJUSTMENT_S = 5 * 60;
/** The logging block runs the APE recalculation; it is never reallocated. */
export const FIXED_BLOCKS: BlockId[] = ['LOGGING'];

/**
 * Blocks that lose time are drained in descending order of base duration so
 * the schedule always sums to 45:00 without emptying a block.
 */
const DRAIN_PRIORITY: BlockId[] = ['DICTATION', 'VISUOSPATIAL', 'VECTOR', 'VOCAL'];

export interface ScheduleInput {
  date: string;
  active_locks: StructuralLock[];
  forced_repeat_modules: ModuleId[];
  notes?: string[];
}

export function buildDailySchedule(input: ScheduleInput): DailySchedule {
  const desired = new Map<BlockId, { minutes: number; reason: string | null }>();
  for (const b of BASE_BLOCK_MINUTES) desired.set(b.block, { minutes: b.minutes, reason: null });

  // Route time toward the block owning each active Structural Lock.
  const lockBlocks = new Set<BlockId>();
  for (const lock of input.active_locks) {
    if (!lock.remediation_active) continue;
    const block = MODULES[lock.module_id].block;
    lockBlocks.add(block);
    const cur = desired.get(block);
    if (cur) cur.reason = `active Structural Lock: ${lock.tag}`;
  }

  for (const block of lockBlocks) {
    if (FIXED_BLOCKS.includes(block)) continue;
    const cur = desired.get(block);
    if (!cur) continue;
    cur.minutes = Math.min(cur.minutes + MAX_ADJUSTMENT_S / 60, cur.minutes * 2);
  }

  // Rebalance so the total is exactly 45:00.
  const desiredTotal = [...desired.values()].reduce((a, b) => a + b.minutes, 0);
  let delta = desiredTotal - 45;
  for (const block of DRAIN_PRIORITY) {
    if (Math.abs(delta) < 0.001) break;
    const cur = desired.get(block);
    if (!cur) continue;
    if (delta > 0) {
      const take = Math.min(delta, cur.minutes - 2);
      if (take <= 0) continue;
      cur.minutes -= take;
      delta -= take;
    } else {
      const give = Math.min(-delta, 2);
      cur.minutes += give;
      delta += give;
    }
  }

  const blocks: BlockAllocation[] = [];
  let cursor = 0;
  for (const b of BASE_BLOCK_MINUTES) {
    const cur = desired.get(b.block);
    if (!cur) continue;
    const baseSeconds = b.minutes * 60;
    const duration = Math.round(cur.minutes * 60);
    const adjustment = duration - baseSeconds;
    blocks.push({
      block: b.block,
      title: b.title,
      start_s: cursor,
      end_s: cursor + duration,
      duration_s: duration,
      adjustment_s: adjustment,
      adjustment_reason: cur.reason,
    });
    cursor += duration;
  }

  const notes = [...(input.notes ?? [])];
  if (input.forced_repeat_modules.length) {
    notes.push('forced repeat runs scheduled at current APE-calculated thresholds');
  }
  if (input.active_locks.some((l) => l.remediation_active)) {
    notes.push('block weighting reflects active Structural Locks — candidate not notified of which block was extended');
  }

  return {
    date: input.date,
    total_s: cursor,
    blocks,
    forced_repeat_modules: input.forced_repeat_modules,
    notes,
  };
}

export function blocksForModules(modules: ModuleId[]): BlockId[] {
  return [...new Set(modules.map((m) => MODULES[m].block))];
}
