/**
 * Section 16.1 / 16.3 — the routine is chosen server-side.
 *
 * These are the pure decisions: that a module parameter is refused, and that
 * block order is fixed while the module filling a block follows the documented
 * priority. The HTTP surface that exposes them is covered by
 * scripts/routineEnforcement.ts, which needs a running server.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALL_MODULE_IDS, BASE_BLOCK_MINUTES, MODULES, PHASE_UNLOCK_RANK, RANK_ORDER, rankAtLeast } from '../src/core/modules.js';
import { HttpError } from '../src/service/httpError.js';
import { rejectModuleParam } from '../src/service/dailyRoutine.js';

test('a module parameter is refused, not silently ignored', () => {
  for (const id of ALL_MODULE_IDS) {
    assert.throws(
      () => rejectModuleParam(id),
      (err: unknown) => err instanceof HttpError && err.status === 400,
      `?module=${id} was not refused`,
    );
  }
  // An empty string is still a supplied parameter.
  assert.throws(() => rejectModuleParam(''), HttpError);
  // Absent is the only accepted case.
  assert.doesNotThrow(() => rejectModuleParam(undefined));
});

test('the daily shape is fixed: same blocks, same order, every day', () => {
  const shape = BASE_BLOCK_MINUTES.map((b) => b.block);
  assert.deepEqual(shape, ['VOCAL', 'VECTOR', 'DICTATION', 'VISUOSPATIAL', 'LOGGING']);

  // Durations are part of the contract with the candidate: 5/10/15/12/3.
  assert.deepEqual(
    BASE_BLOCK_MINUTES.map((b) => b.minutes),
    [5, 10, 15, 12, 3],
  );

  // LOGGING is system-only and must never become a selectable module.
  assert.ok(
    !ALL_MODULE_IDS.some((m) => MODULES[m].block === 'LOGGING'),
    'a module was registered against the LOGGING block',
  );
});

test('every block except LOGGING is served by at least one module', () => {
  for (const b of BASE_BLOCK_MINUTES) {
    if (b.block === 'LOGGING') continue;
    const any = ALL_MODULE_IDS.filter((m) => MODULES[m].block === b.block);
    assert.ok(any.length > 0, `block ${b.block} has no module`);
  }
});

test('a block can be served by more than one module, which is why binding matters', () => {
  const byBlock = new Map<string, string[]>();
  for (const m of ALL_MODULE_IDS) {
    const list = byBlock.get(MODULES[m].block) ?? [];
    list.push(m);
    byBlock.set(MODULES[m].block, list);
  }
  // VECTOR and VISUOSPATIAL both gain a phase-2/3 module; without a binding
  // layer the scheduler would have no principled way to choose between them.
  assert.ok((byBlock.get('VECTOR')?.length ?? 0) > 1, 'VECTOR has only one module');
  assert.ok((byBlock.get('VISUOSPATIAL')?.length ?? 0) > 1, 'VISUOSPATIAL has only one module');
});

test('phase gating still bounds what the routine may contain', () => {
  // RANK_ORDER is weakest-first, so index 0 is the entry rank a fresh candidate
  // holds. Nothing above phase 1 may be reachable from there.
  const entry = RANK_ORDER[0]!;
  for (const m of ALL_MODULE_IDS) {
    const needed = PHASE_UNLOCK_RANK[MODULES[m].phase];
    if (needed === null) continue;
    assert.ok(
      !rankAtLeast(entry, needed),
      `${m} (phase ${MODULES[m].phase}) is reachable from the entry rank`,
    );
  }
  // And the top rank must satisfy every phase requirement.
  const top = RANK_ORDER[RANK_ORDER.length - 1]!;
  for (const m of ALL_MODULE_IDS) {
    const needed = PHASE_UNLOCK_RANK[MODULES[m].phase];
    assert.ok(needed === null || rankAtLeast(top, needed), `${m} is unreachable even at the top rank`);
  }
});
