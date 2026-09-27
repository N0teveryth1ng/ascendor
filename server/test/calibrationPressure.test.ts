/**
 * The timed calibration pass must actually be harder than the untimed one.
 *
 * Every calibration vector is an untimed/timed pair, and C4 and C5 exist
 * specifically to measure a timed-versus-untimed contrast. The probe profile
 * scaled the timed response window to 60% and the timed WPM ceiling to 320, but
 * `buildSession` reads its threshold from `window.current_threshold_ms`, and a
 * candidate who has never trained carries the INITIAL_THRESHOLD default of
 * 2400 — which is also the probe's *untimed* value. The 0.6 factor was computed
 * and then dropped on the floor.
 *
 * The live consequence: C3, C4 and C5 served byte-identical configuration on
 * both passes. C3 was still distinguishable by rate, but C4 and C5 were not
 * distinguishable at all, so their contrast measured nothing and the derived
 * profiles were built from two readings of the same test.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSession } from '../src/content/index.js';
import { emptyWindow } from '../src/db/repo.js';
import { CALIBRATION_PRESSURE, probePcp, windowForPass } from '../src/service/sessionPlan.js';
import type { ModuleId } from '../src/core/types.js';

/** The module each vector is served from, mirroring the probe route. */
const VECTOR_MODULE: Record<string, ModuleId> = {
  C3: 'P3_HVS',
  C4: 'P1_VM',
  C5: 'P2_RDI',
};

function planFor(moduleId: ModuleId, passType: 'untimed' | 'timed') {
  const pcp = probePcp('candidate-a', passType);
  return buildSession(moduleId, {
    candidate_id: 'candidate-a',
    pcp,
    window: windowForPass(emptyWindow(), pcp, false),
    locks: [],
    session_index: 1,
  });
}

test('the timed probe profile really is tighter', () => {
  const untimed = probePcp('candidate-a', 'untimed').phase_1_entry_difficulty_seed;
  const timed = probePcp('candidate-a', 'timed').phase_1_entry_difficulty_seed;
  assert.equal(timed.latency_threshold_ms, Math.round(untimed.latency_threshold_ms * CALIBRATION_PRESSURE.timed.threshold_factor));
  assert.ok(timed.latency_threshold_ms < untimed.latency_threshold_ms);
  assert.ok(timed.wpm_ceiling > untimed.wpm_ceiling);
});

test('a probe takes its window from the probe profile, not the empty-window default', () => {
  // The default and the untimed seed are both 2400, which is why the mistake was
  // invisible on the untimed pass and only showed up as a missing contrast.
  assert.equal(emptyWindow().current_threshold_ms, probePcp('c', 'untimed').phase_1_entry_difficulty_seed.latency_threshold_ms);

  const timed = windowForPass(emptyWindow(), probePcp('c', 'timed'), false);
  assert.equal(timed.current_threshold_ms, 1440);
  assert.equal(timed.current_threshold_ms, probePcp('c', 'timed').phase_1_entry_difficulty_seed.latency_threshold_ms);
});

test('a real training session still uses its own adaptive window', () => {
  // Gated sessions must keep the candidate's own window; overriding it with the
  // probe profile would reset adaptive difficulty on every ordinary session.
  const live = { ...emptyWindow(), current_threshold_ms: 1750 };
  assert.equal(windowForPass(live, probePcp('c', 'timed'), true).current_threshold_ms, 1750);
});

test('every module-backed vector serves a tighter timed pass than untimed', () => {
  for (const [vector, moduleId] of Object.entries(VECTOR_MODULE)) {
    const untimed = planFor(moduleId, 'untimed');
    const timed = planFor(moduleId, 'timed');

    for (const plan of [untimed, timed]) {
      assert.ok(plan.items.length > 0, `${vector} served no items`);
      for (const item of plan.items) {
        assert.ok(
          Number.isFinite(item.threshold_ms) && item.threshold_ms > 0,
          `${vector} served an item with no usable response window`,
        );
      }
    }

    const untimedThresholds = new Set(untimed.items.map((i) => i.threshold_ms));
    const timedThresholds = new Set(timed.items.map((i) => i.threshold_ms));
    assert.equal(untimedThresholds.size, 1, `${vector} untimed pass had mixed windows`);
    assert.equal(timedThresholds.size, 1, `${vector} timed pass had mixed windows`);

    const [u] = [...untimedThresholds] as [number];
    const [t] = [...timedThresholds] as [number];
    assert.ok(
      t < u,
      `${vector} (${moduleId}) served the same ${t}ms window on both passes, ` +
        'so its timed-versus-untimed contrast measured nothing',
    );
  }
});

test('C3 and C4 differ in configuration between passes, not only in rate', () => {
  // C3 is additionally distinguished by WPM, which is why it produced a real
  // speed curve even before the window fix. C4 has no such second axis, so the
  // window was its only source of contrast.
  const c3u = planFor('P3_HVS', 'untimed');
  const c3t = planFor('P3_HVS', 'timed');
  assert.ok((c3t.items[0] as { wpm?: number }).wpm! > (c3u.items[0] as { wpm?: number }).wpm!);

  const c4u = planFor('P1_VM', 'untimed');
  const c4t = planFor('P1_VM', 'timed');
  assert.ok(
    c4t.items[0]!.threshold_ms < c4u.items[0]!.threshold_ms,
    'C4 has no rate axis, so a tighter window is the only thing that makes its timed pass a measurement',
  );
});
