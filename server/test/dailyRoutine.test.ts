/**
 * Section 16.1 / 16.3 — the routine is chosen server-side.
 *
 * Two layers of test. The HTTP surface is covered by scripts/routineEnforcement.ts,
 * which needs a running server. Everything below tests the pure decision, so the
 * selection priorities are proven without a database: buildDailyRoutine only
 * reads rank, locks and rolling windows, and hands them to assembleRoutine.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALL_MODULE_IDS,
  BASE_BLOCK_MINUTES,
  MODULES,
  PHASE_UNLOCK_RANK,
  RANK_ORDER,
  rankAtLeast,
} from '../src/core/modules.js';
import { HttpError } from '../src/service/httpError.js';
import { assembleRoutine, rejectModuleParam, resolveStepModule } from '../src/service/dailyRoutine.js';
import type { ModuleId, Rank, RollingWindow, SessionSummary } from '../src/core/types.js';

const ENTRY = RANK_ORDER[0]!; // weakest-first, so index 0 is the entry rank
const TOP = RANK_ORDER[RANK_ORDER.length - 1]!;

function windowWith(accuracy: number, n = 8): RollingWindow {
  const last: SessionSummary[] = Array.from({ length: n }, (_, i) => ({
    session_id: `S${i}`,
    started_at: new Date(Date.UTC(2026, 0, i + 1)).toISOString(),
    module_id: 'P1_VM' as ModuleId,
    sublevel: 1,
    accuracy_pct: accuracy,
    mean_latency_ms: 400,
    errors: [],
  }));
  return {
    last_8_sessions: last,
    current_threshold_ms: 1000,
    speed_multiplier: 1,
    adjustment_factor_log: [],
    sublevel: 1,
    consecutive_in_band: 0,
    escalation_ready: false,
  } as unknown as RollingWindow;
}

/** Top rank with no signal, so nothing but the tie-rotation can decide. */
function routineAtTop(date: string, windows: Record<string, RollingWindow> = {}, locks: { module_id: ModuleId; remediation_active: boolean }[] = []) {
  return assembleRoutine({ candidateId: 'C1', date, rank: TOP, locks, windows });
}

/** Every module that could serve a block at the top rank, in registry order. */
function modulesInBlock(block: string): ModuleId[] {
  return ALL_MODULE_IDS.filter((m) => MODULES[m].block === block);
}

/** The module list the server bound to a block today. */
function boundTo(routine: ReturnType<typeof routineAtTop>, block: string): ModuleId[] {
  return routine.steps.find((s) => s.block === block)!.modules.map((m) => m.module_id);
}

/* ── 16.1: the caller cannot name a module ────────────────────────────────── */

test('a module parameter is refused, not silently ignored', () => {
  for (const id of ALL_MODULE_IDS) {
    assert.throws(
      () => rejectModuleParam(id),
      (err: unknown) => err instanceof HttpError && err.status === 400,
      `module=${id} was not refused`,
    );
  }
  // An empty string is still a supplied parameter, and must not read as absent.
  assert.throws(() => rejectModuleParam(''), HttpError);
  // Absent is the only accepted case.
  assert.doesNotThrow(() => rejectModuleParam(undefined));
});

test('a position outside the server-built routine is refused, not clamped', () => {
  const routine = routineAtTop('2026-01-01');
  const first = routine.steps[0]!;
  const count = first.modules.length;

  // The happy path resolves.
  assert.equal(
    resolveStepModule(routine, first.order, 1).module.module_id,
    first.modules[0]!.module_id,
  );

  // Anything past the end of the server's list is refused. Clamping would let a
  // client ask for position 99 and silently train on something else.
  assert.throws(() => resolveStepModule(routine, first.order, count + 1), HttpError);
  assert.throws(() => resolveStepModule(routine, first.order, 0), HttpError);
  assert.throws(() => resolveStepModule(routine, routine.steps.length + 1, 1), HttpError);
  assert.throws(() => resolveStepModule(routine, 0, 1), HttpError);
});

/* ── the fixed daily shape ─────────────────────────────────────────────────── */

test('the daily shape is fixed: same blocks, same order, same minutes', () => {
  const r = routineAtTop('2026-01-01');
  const contentBlocks = BASE_BLOCK_MINUTES.filter((b) => b.block !== 'LOGGING');

  assert.deepEqual(
    r.steps.map((s) => s.block),
    contentBlocks.map((b) => b.block),
    'routine order drifted from the fixed block order',
  );
  assert.deepEqual(r.steps.map((s) => s.minutes), contentBlocks.map((b) => b.minutes));
  // order is 1-based and contiguous.
  assert.deepEqual(r.steps.map((s) => s.order), r.steps.map((_, i) => i + 1));
  // 5/10/15/12, with LOGGING handled by the system, not as a step.
  assert.deepEqual(BASE_BLOCK_MINUTES.map((b) => b.minutes), [5, 10, 15, 12, 3]);
  assert.ok(!r.steps.some((s) => s.block === 'LOGGING'), 'LOGGING became a selectable step');
});

test('the same day twice gives the same routine', () => {
  const a = routineAtTop('2026-03-07');
  const b = routineAtTop('2026-03-07');
  assert.deepEqual(a.steps, b.steps, 'routine is not deterministic for a fixed day');
});

/* ── every eligible module runs: the anti-starvation guarantee ─────────────── */

test('every eligible module is bound to a block, none dropped', () => {
  // A block is a time budget holding several modules, so binding only one would
  // skip the rest every day. DICTATION holds three, which is where a
  // one-module-per-block design would quietly lose two of them.
  const r = routineAtTop('2026-01-01');
  const bound = new Set(r.steps.flatMap((s) => s.modules.map((m) => m.module_id)));
  for (const m of ALL_MODULE_IDS) {
    assert.ok(bound.has(m), `${m} was eligible at the top rank but never bound to a block`);
  }
  assert.equal(bound.size, ALL_MODULE_IDS.length, 'a module was bound to more than one block');
});

test('a weak module cannot starve a strong one out of its block', () => {
  const block = modulesInBlock('DICTATION');
  assert.ok(block.length > 2, 'need a block with three modules for this to mean anything');
  const strong = block[0]!;
  const weak = block[1]!;

  // One module is failing badly, the other is perfect, the third untested.
  const windows: Record<string, RollingWindow> = { [strong]: windowWith(100), [weak]: windowWith(20) };
  const r = routineAtTop('2026-01-01', windows, []);

  const bound = boundTo(r, 'DICTATION');
  assert.ok(bound.includes(weak), 'the failing module lost its place');
  assert.ok(bound.includes(strong), 'the perfect module was starved out despite still being eligible');
  assert.ok(bound.length >= 2);
});

test('weakness orders a block; it never removes a module from it', () => {
  const block = modulesInBlock('VECTOR');
  const [first, second] = block as [ModuleId, ModuleId];
  const windows: Record<string, RollingWindow> = { [second]: windowWith(30), [first]: windowWith(95) };
  const bound = boundTo(routineAtTop('2026-01-01', windows, []), 'VECTOR');

  assert.deepEqual(bound, [second, first], 'the weaker module should lead the block, both should be present');
});

/* ── priority 1: an open Structural Lock leads its block ───────────────────── */

test('an open lock puts its module at the front of its block', () => {
  const block = modulesInBlock('VECTOR');
  const locked = block[1]!;
  // Make the other module dramatically stronger. If weakness could outrank the
  // lock, it would, and the lock's whole purpose is that it cannot.
  const windows: Record<string, RollingWindow> = {};
  for (const m of block) windows[m] = windowWith(m === locked ? 10 : 100);

  const r = routineAtTop('2026-01-01', windows, [{ module_id: locked, remediation_active: true }]);
  const step = r.steps.find((s) => s.block === 'VECTOR')!;

  assert.equal(step.modules[0]!.module_id, locked, 'weakness-first outranked an open Structural Lock');
  assert.equal(step.modules[0]!.lock_driven, true);
  assert.match(step.modules[0]!.selection_reason, /Structural Lock/);
});

test('a cleared lock does not keep steering the routine', () => {
  const block = modulesInBlock('VECTOR');
  const stale = block[1]!;
  const other = block[0]!;
  // The stale lock sits on a *strong* module, so the two cases can differ: with
  // the lock open it must lead despite the weakness gap, and once cleared the
  // genuinely weaker module must take over. If the stale module were the weak
  // one it would lead either way and the test would prove nothing.
  const windows: Record<string, RollingWindow> = { [stale]: windowWith(100), [other]: windowWith(20) };

  const withLock = routineAtTop('2026-01-01', windows, [{ module_id: stale, remediation_active: true }]);
  const cleared = routineAtTop('2026-01-01', windows, [{ module_id: stale, remediation_active: false }]);

  assert.equal(
    withLock.steps.find((s) => s.block === 'VECTOR')!.modules[0]!.module_id,
    stale,
    'an open lock did not lead its block',
  );
  assert.equal(
    cleared.steps.find((s) => s.block === 'VECTOR')!.modules[0]!.module_id,
    other,
    'a lock with remediation_active=false still led its block',
  );
  // Clearing the lock must not remove the module from the routine.
  assert.ok(boundTo(cleared, 'VECTOR').includes(stale), 'the cleared module dropped out of the block');
});

/* ── priority 2: weakness-first ────────────────────────────────────────────── */

test('weakness is read from the rolling window, not a separate accuracy column', () => {
  const block = modulesInBlock('VECTOR');
  const target = block[0]!;
  // One bad session inside the 8-session window must move it to the front:
  // this proves the score is the window mean, not a last-session read.
  const mixed = windowWith(100, 7);
  mixed.last_8_sessions[7] = { ...mixed.last_8_sessions[7]!, accuracy_pct: 20 };
  const windows: Record<string, RollingWindow> = { [target]: mixed };
  for (const m of block.slice(1)) windows[m] = windowWith(98);

  assert.equal(boundTo(routineAtTop('2026-01-01', windows, []), 'VECTOR')[0], target);
});

test('a module with no sessions is neutral, not maximally weak', () => {
  const block = modulesInBlock('VECTOR');
  const [first, second] = block as [ModuleId, ModuleId];
  // first has strong evidence, second has none at all.
  const windows: Record<string, RollingWindow> = { [first]: windowWith(100) };
  const bound = boundTo(routineAtTop('2026-01-01', windows, []), 'VECTOR');

  // A real 0.2 weakness score must outrank a neutral 0.5, so novelty alone never
  // pulls an untested module to the front of the block.
  assert.equal(bound[0], second, 'an untested module should lead only against a perfect one, by tie-break');
  assert.ok(bound.includes(first), 'the proven module was dropped from the block');
});

/* ── priority 3: rotation only reorders genuine ties ───────────────────────── */

test('an exact weakness tie is reordered by the date', () => {
  const block = modulesInBlock('VECTOR');
  const windows: Record<string, RollingWindow> = {};
  for (const m of block) windows[m] = windowWith(80); // perfectly tied

  const orders = new Set<string>();
  for (const date of ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04', '2026-01-05']) {
    orders.add(boundTo(routineAtTop(date, windows), 'VECTOR').join(','));
  }
  assert.ok(orders.size > 1, 'a tied block never rotated — the date seed is not reaching the order');

  // Within one day it is still deterministic.
  assert.deepEqual(boundTo(routineAtTop('2026-02-02', windows), 'VECTOR'), boundTo(routineAtTop('2026-02-02', windows), 'VECTOR'));
});

test('a real weakness gap suppresses the rotation entirely', () => {
  const block = modulesInBlock('VECTOR');
  const weakest = block[0]!;
  const windows: Record<string, RollingWindow> = {};
  for (const m of block) windows[m] = windowWith(m === weakest ? 60 : 90);

  const firsts = new Set<string>();
  for (let d = 1; d <= 10; d += 1) {
    const date = `2026-01-${String(d).padStart(2, '0')}`;
    firsts.add(boundTo(routineAtTop(date, windows), 'VECTOR')[0]!);
  }
  assert.deepEqual([...firsts], [weakest], 'the block rotated despite an unambiguous weakness gap');
});

/* ── phase gating still bounds the routine ─────────────────────────────────── */

test('a low rank cannot be served a module above its phase', () => {
  const r = assembleRoutine({ candidateId: 'C1', date: '2026-01-01', rank: ENTRY, locks: [], windows: {} });
  for (const s of r.steps) {
    for (const m of s.modules) {
      const needed = PHASE_UNLOCK_RANK[MODULES[m.module_id].phase];
      assert.ok(needed === null || rankAtLeast(ENTRY, needed), `${m.module_id} is above the entry rank`);
    }
  }
});

test('a block with no eligible module is reported, not silently dropped', () => {
  const r = assembleRoutine({ candidateId: 'C1', date: '2026-01-01', rank: ENTRY, locks: [], windows: {} });
  const total = BASE_BLOCK_MINUTES.filter((b) => b.block !== 'LOGGING').length;
  assert.equal(r.steps.length + r.empty_blocks.length, total, 'a block was neither served nor reported');
  for (const e of r.empty_blocks) assert.match(e.reason, /unlocked at the current rank/);
});

test('the routine never reports LOGGING as empty or as a step', () => {
  const r = routineAtTop('2026-01-01');
  assert.ok(!r.empty_blocks.some((e) => e.block === 'LOGGING'), 'LOGGING should be skipped, not reported empty');
  assert.ok(!r.steps.some((s) => s.block === 'LOGGING'));
});
