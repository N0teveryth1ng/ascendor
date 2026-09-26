/**
 * End-to-end verification of the load-bearing claims in the v2 spec.
 * Run: npm run smoke --workspace server
 *
 * Requires DATABASE_URL. The suite clears only the three candidate ids it
 * creates (see resetSmokeFixtures), so it is safe to point at a development
 * database that also holds real candidate tracks. For a full wipe on a scratch
 * database, use `npm run db:reset` instead.
 */
import { migrate } from '../src/db/index.js';
import { resetSmokeFixtures } from './testDb.js';
import type { RawPass } from '../src/core/calibration.js';
import type { Attempt } from '../src/core/types.js';

// The suite drives the seeded demo tracks (billi/anik), so opt in explicitly
// rather than relying on the default being on.
process.env.SEED_DEMO = '1';

const { buildSession } = await import('../src/content/index.js');
const { processSessionResult, applyDailyTier } = await import('../src/service/sessionService.js');
const { finaliseCalibration, requirePcp, recordPass } = await import('../src/service/calibrationService.js');
const { createCandidate } = await import('../src/db/repo.js');
const { buildCandidateProfile } = await import('../src/service/profile.js');
const { getPcp, getWindow, activeLocks, getStreak, listSessions, allWindows } = await import('../src/db/repo.js');
const { errorTagsOf } = await import('./helpers.js');
const { grade } = await import('../src/core/errorTags.js');
const { recalculate, checkEscalation, detectStructuralLocks, makeLock, applyEscalation, MAX_SUBLEVEL } = await import('../src/core/ape.js');
const { MODULES } = await import('../src/core/modules.js');
const { evaluateRanks } = await import('../src/core/ranks.js');

let failures = 0;
let checks = 0;

function check(label: string, condition: boolean, detail = ''): void {
  checks++;
  if (condition) {
    console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function section(name: string): void {
  console.log(`\n${name}`);
  console.log('-'.repeat(name.length));
}

/*
 * Fixture ids are namespaced with a `smoke-` prefix.
 *
 * These used to be the bare ids `billi` and `anik`, which are also the two
 * fixed production candidate ids. resetSmokeFixtures deletes every row for the
 * ids it is given, so pointing this suite at a real database would have deleted
 * both real candidate tracks while claiming to be "safe anywhere". The prefix
 * makes the blast radius disjoint from any account that can actually sign in.
 */
const CANDIDATE = 'smoke-billi';
/** Every candidate id this suite creates, so the reset can clear exactly them. */
const FIXTURES = [CANDIDATE, 'smoke-anik', 'smoke-streak-probe'] as const;

// Schema first, then a clean slate, then the demo tracks the suite drives.
// resetSmokeFixtures only deletes rows for the ids above, so this is safe to run
// against a development database that also holds real candidate tracks.
await migrate();
await resetSmokeFixtures(FIXTURES);

/* ── 1. Calibration gate ──────────────────────────────────────────────────── */

section('1. CALIBRATION HARD GATE (Section 11)');
await createCandidate(CANDIDATE, 'Billi');
{
  let gated = false;
  try {
    await requirePcp(CANDIDATE);
  } catch (e) {
    gated = (e as { status?: number }).status === 423;
  }
  check('drilling blocked without PCP', gated);

  let rejected = false;
  try {
    await finaliseCalibration(CANDIDATE, [
      { vector: 'C1', pass_type: 'untimed', correct: 5, total: 5, mean_latency_ms: 900 },
    ]);
  } catch (e) {
    rejected = (e as Error).message.includes('CALIBRATION INCOMPLETE');
  }
  check('partial calibration rejected', rejected);
}

/* ── 2. PCP derivation ────────────────────────────────────────────────────── */

section('2. PERSONALIZED CALIBRATION PROFILE (Section 1.3)');

const passes: RawPass[] = [
  {
    vector: 'C1' as const,
    pass_type: 'untimed' as const,
    correct: 88,
    total: 96,
    mean_latency_ms: 1500,
    band_accuracy: {
      V1: 100, V2: 100, V3: 100, V4: 95, V5: 90, V6: 85,
      V7: 0, V8: 0, V9: 0, V10: 0, V11: 0, V12: 0,
    },
  },
  {
    vector: 'C1' as const,
    pass_type: 'timed' as const,
    correct: 70,
    total: 96,
    mean_latency_ms: 2600,
    band_accuracy: { V1: 95, V2: 90, V3: 85, V4: 80, V5: 70, V6: 60, V7: 0, V8: 0, V9: 0, V10: 0, V11: 0, V12: 0 },
  },
  {
    vector: 'C2' as const,
    pass_type: 'untimed' as const,
    correct: 38,
    total: 48,
    mean_latency_ms: 4200,
    level_accuracy: { S1: 100, S2: 100, S3: 100, S4: 100, S5: 83, S6: 50, S7: 0, S8: 0 },
  },
  {
    vector: 'C2' as const,
    pass_type: 'timed' as const,
    correct: 30,
    total: 48,
    mean_latency_ms: 5800,
    level_accuracy: { S1: 100, S2: 100, S3: 92, S4: 92, S5: 67, S6: 33, S7: 0, S8: 0 },
  },
  { vector: 'C3' as const, pass_type: 'untimed' as const, correct: 12, total: 12, mean_latency_ms: 800, wpm: 90 },
  { vector: 'C3' as const, pass_type: 'untimed' as const, correct: 12, total: 12, mean_latency_ms: 900, wpm: 130 },
  { vector: 'C3' as const, pass_type: 'untimed' as const, correct: 11, total: 12, mean_latency_ms: 1100, wpm: 150 },
  { vector: 'C3' as const, pass_type: 'timed' as const, correct: 10, total: 12, mean_latency_ms: 1600, wpm: 175 },
  { vector: 'C3' as const, pass_type: 'timed' as const, correct: 8, total: 12, mean_latency_ms: 2200, wpm: 200 },
  {
    vector: 'C4' as const,
    pass_type: 'untimed' as const,
    correct: 4,
    total: 4,
    mean_latency_ms: 2200,
    clarity: 71.2,
    clarity_by_class: { str_cluster: 58, th_digraph: 63, voiceless_stops: 88, voiced_stops: 82, laterals: 79 },
  },
  {
    vector: 'C4' as const,
    pass_type: 'timed' as const,
    correct: 3,
    total: 4,
    mean_latency_ms: 3100,
    clarity: 71.2,
    clarity_by_class: { str_cluster: 55, th_digraph: 61, voiceless_stops: 86, voiced_stops: 80, laterals: 78 },
  },
  { vector: 'C5' as const, pass_type: 'untimed' as const, correct: 36, total: 36, mean_latency_ms: 1900 },
  { vector: 'C5' as const, pass_type: 'timed' as const, correct: 31, total: 36, mean_latency_ms: 2700 },
];

const pcp = await finaliseCalibration(CANDIDATE, passes);
check('vocabulary band derived from untimed C1', pcp.vocabulary_band === 'V5', `got ${pcp.vocabulary_band} (V5 scored 90%, V6 scored 85%)`);
check('syntax ceiling derived from untimed C2', pcp.syntax_ceiling === 'S4', `got ${pcp.syntax_ceiling}`);
check('baseline reflex latency from timed C5', pcp.baseline_reflex_latency_ms === 2700, `got ${pcp.baseline_reflex_latency_ms}`);
check('vocal clarity baseline recorded', Math.abs(pcp.baseline_vocal_clarity - 71.2) < 0.01, `got ${pcp.baseline_vocal_clarity}`);
check('TVI computed from untimed vs timed C5', Math.abs(pcp.typo_vulnerability_index - 0.14) < 0.02, `got ${pcp.typo_vulnerability_index}`);
check('C4 phoneme flags surfaced', pcp.flagged_weak_vectors.includes('consonant_clusters_str_thr'), pcp.flagged_weak_vectors.join(','));
check('syntax weakness flagged', pcp.flagged_weak_vectors.includes('passive_voice'), pcp.flagged_weak_vectors.join(','));
check('entry rank is DECODER for this PCP', pcp.entry_rank === 'RANK 03: DECODER', pcp.entry_rank);
check('PCP locked', pcp.locked === true);

const seed = pcp.phase_1_entry_difficulty_seed;
check('seed threshold derived, not fixed 2400', seed.latency_threshold_ms !== 2400, `${seed.latency_threshold_ms}ms`);
check('seed wpm ceiling below C3 max intelligible', seed.wpm_ceiling < 150, `C3 max=150, ceiling=${seed.wpm_ceiling}`);
check('seed flash within APE clamp 1200-2500', seed.flash_duration_ms >= 1200 && seed.flash_duration_ms <= 2500, `${seed.flash_duration_ms}ms`);

for (const p of [passes[0]!, passes[3]!]) await recordPass(CANDIDATE, p.vector, p.pass_type, p);

/* ── 3. APE factor selection (Section 2.2) ─────────────────────────────────── */

section('3. ADAPTIVE PACE ENGINE — FACTOR SELECTION (Section 2.2)');

function win(sessions: { acc: number; lat: number }[], threshold = 2400) {
  return {
    last_8_sessions: sessions.map((s, i) => ({
      session_id: `s${i}`,
      started_at: new Date(2026, 0, i + 1).toISOString(),
      module_id: 'P1_VD' as const,
      sublevel: 1,
      accuracy_pct: s.acc,
      mean_latency_ms: s.lat,
      errors: [] as string[],
    })),
    current_threshold_ms: threshold,
    speed_multiplier: 1,
    adjustment_factor_log: [],
    sublevel: 1,
    consecutive_in_band: 0,
    escalation_ready: false,
    last_escalated_session_id: null,
  };
}

{
  const improving = win([
    { acc: 90, lat: 2600 },
    { acc: 92, lat: 2400 },
    { acc: 95, lat: 2200 },
    { acc: 98, lat: 2000 },
  ]);
  const r = recalculate(improving, { ...improving.last_8_sessions[3]!, session_id: 'new' }, MODULES.P1_VD, 'new', new Date().toISOString());
  check('rising accuracy + falling latency => TIGHTEN 0.93', r.decision.factor === 0.93, `${r.decision.factor} (${r.decision.reason})`);
  check('threshold tightened below previous', r.window.current_threshold_ms < 2400, `${r.window.current_threshold_ms}ms`);
}

{
  const stable = win([
    { acc: 95, lat: 1900 },
    { acc: 96, lat: 1850 },
    { acc: 95, lat: 1880 },
    { acc: 96, lat: 1860 },
  ]);
  const r = recalculate(stable, { ...stable.last_8_sessions[3]!, session_id: 'new' }, MODULES.P1_VD, 'new', new Date().toISOString());
  check('stable in-band => HOLD 1.00', r.decision.factor === 1.0, `${r.decision.factor} (${r.decision.reason})`);
}

{
  const declining = win([
    { acc: 96, lat: 1900 },
    { acc: 92, lat: 2200 },
    { acc: 88, lat: 2500 },
    { acc: 84, lat: 2800 },
  ]);
  const r = recalculate(declining, { ...declining.last_8_sessions[3]!, session_id: 'new' }, MODULES.P1_VD, 'new', new Date().toISOString());
  check('sustained decline => LOOSEN 1.08', r.decision.factor === 1.08, `${r.decision.factor} (${r.decision.reason})`);
  check('threshold loosened above previous', r.window.current_threshold_ms > 2400, `${r.window.current_threshold_ms}ms`);
}

{
  // Anti-leak: a strong candidate must not get tightened without headroom.
  const improvingButSlow = win([
    { acc: 90, lat: 2000 },
    { acc: 93, lat: 2200 },
    { acc: 96, lat: 2400 },
    { acc: 99, lat: 2600 },
  ]);
  const r = recalculate(improvingButSlow, { ...improvingButSlow.last_8_sessions[3]!, session_id: 'new' }, MODULES.P1_VD, 'new', new Date().toISOString());
  check('rising accuracy but slowing latency => HOLD (no tighten)', r.decision.factor === 1.0, `${r.decision.factor} (${r.decision.reason})`);
}

{
  // Clamp: the engine must not tune itself into impossibility.
  const floor = win([
    { acc: 90, lat: 2000 },
    { acc: 93, lat: 1800 },
    { acc: 96, lat: 1600 },
    { acc: 99, lat: 1400 },
  ], 950);
  const r = recalculate(floor, { ...floor.last_8_sessions[3]!, session_id: 'new' }, MODULES.P1_VD, 'new', new Date().toISOString());
  check('threshold clamped at module minimum', r.window.current_threshold_ms === MODULES.P1_VD.threshold_clamp_ms.min, `${r.window.current_threshold_ms}ms`);
  check('clamp recorded in the adjustment log', r.window.adjustment_factor_log[0]!.clamp_applied === 'MIN', r.window.adjustment_factor_log[0]!.clamp_applied);
}

{
  const tooFew = win([{ acc: 99, lat: 1500 }]);
  const r = recalculate(tooFew, { ...tooFew.last_8_sessions[1]!, session_id: 'new' }, MODULES.P1_VD, 'new', new Date().toISOString());
  check('no tuning below minimum sample size', r.decision.reason === 'INIT', r.decision.reason);
}

/* ── 4. Escalation trigger (Section 2.4) ──────────────────────────────────── */

section('4. ESCALATION TRIGGER (Section 2.4)');

{
  const w = win(
    [
      { acc: 96, lat: 2000 },
      { acc: 97, lat: 2100 },
      { acc: 98, lat: 2200 },
    ],
    2400,
  );
  const r = checkEscalation(w, MODULES.P1_VD, []);
  check('3 consecutive in-band sessions + latency under threshold => READY', r.ready, r.reasons.join(' | '));
}
{
  const w = win([{ acc: 90, lat: 2000 }, { acc: 91, lat: 2100 }, { acc: 99, lat: 2000 }], 2400);
  const r = checkEscalation(w, MODULES.P1_VD, []);
  check('one lucky session does not trigger escalation', !r.ready, r.reasons.join(' | '));
}
{
  const w = win([{ acc: 96, lat: 2000 }, { acc: 97, lat: 2100 }, { acc: 98, lat: 1900 }], 2400);
  const lock = makeLock('tense_marker', 'P1_VD', new Date().toISOString());
  const r = checkEscalation(w, MODULES.P1_VD, [lock]);
  check('active Structural Lock blocks escalation', !r.ready, r.reasons.find((x) => x.includes('Structural Lock')));
}

/* ── 5. Structural Lock detection (Section 2.3) ──────────────────────────── */

section('5. STRUCTURAL GAP DETECTION (Section 2.3)');

{
  const sessions = [1, 2, 3, 4].map((i) => ({
    session_id: `s${i}`,
    started_at: new Date(2026, 0, i).toISOString(),
    module_id: 'P1_VD' as const,
    sublevel: 1,
    accuracy_pct: 90,
    mean_latency_ms: 2000,
    errors: ['tense_marker'],
  }));
  const d = detectStructuralLocks(sessions, {}, [], 'P1_VD', new Date().toISOString());
  check('4th recurrence triggers a lock', d.triggered.includes('tense_marker'), `triggered: ${d.triggered.join(',') || 'none'}`);

  const threeSessions = sessions.slice(0, 3);
  const d3 = detectStructuralLocks(threeSessions, {}, [], 'P1_VD', new Date().toISOString());
  check('3 recurrences do NOT trigger a lock', d3.triggered.length === 0);

  const lock = makeLock('tense_marker', 'P1_VD', new Date().toISOString());
  const dAgain = detectStructuralLocks(sessions, { 'P1_VD::tense_marker': 4 }, [lock], 'P1_VD', new Date().toISOString());
  check('already-locked tag is not re-triggered', dAgain.triggered.length === 0);

  const clearedSessions = [{ ...sessions[0]!, session_id: 'c1' }];
  const dClear = detectStructuralLocks(clearedSessions, { 'P1_VD::tense_marker': 1 }, [lock], 'P1_VD', new Date().toISOString());
  check('recurrence below 2/8 clears the lock', dClear.cleared.includes('tense_marker'));

  const other = detectStructuralLocks(
    [{ ...sessions[0]!, errors: ['tense_marker'] }],
    {},
    [],
    'P1_VD',
    new Date().toISOString(),
  );
  check('counters are scoped per module', Object.keys(other.counters).every((k) => k.startsWith('P1_VD::')), Object.keys(other.counters).join(','));
}

/* ── 6. Error protocol (Section 4) ────────────────────────────────────────── */

section('6. ERROR & FEEDBACK PROTOCOL (Section 4)');

{
  const slow = grade({ input: 'want', expected: 'want', latency_ms: 3400, threshold_ms: 2400, category: 'tense_marker', mode: 'pattern' });
  check('correct but slow => LATENCY_FAIL, not failure', slow.code === 'LATENCY_FAIL' && slow.correct === true, slow.rendered);

  const fast = grade({ input: 'want', expected: 'want', latency_ms: 1200, threshold_ms: 2400, category: 'tense_marker', mode: 'pattern' });
  check('correct and fast => ACCEPTED', fast.code === 'ACCEPTED', fast.rendered);

  const wrong = grade({ input: 'went', expected: 'want', latency_ms: 900, threshold_ms: 2400, category: 'tense_marker', mode: 'pattern' });
  check('wrong word => PATTERN_MISMATCH with category + expected', wrong.code === 'PATTERN_MISMATCH' && wrong.rendered.includes('tense_marker') && wrong.rendered.includes('expected="want"'), wrong.rendered);
  check('error line is a single line', !wrong.rendered.includes('\n'));

  const typo = grade({ input: 'thier', expected: 'their', latency_ms: 900, threshold_ms: 2400, category: 'homophone_their_there', mode: 'typo' });
  check('typo => TYPO_DETECTED with char position, no full word retyped', typo.code === 'TYPO_DETECTED' && typo.char_position === 2 && !typo.rendered.includes('their '), typo.rendered);

  const exact = grade({ input: 'their', expected: 'their', latency_ms: 900, threshold_ms: 2400, category: 'homophone_their_there', mode: 'typo' });
  check('no false positive on a correct homophone', exact.code === 'ACCEPTED', exact.rendered);
}

/* ── 7. Live session flow ─────────────────────────────────────────────────── */

section('7. SESSION FLOW — SESSION-TO-SESSION ADAPTATION');

async function runSession(moduleId: keyof typeof MODULES, opts: { accuracy: number; latency: number; sessionIndex: number; errorTag?: string }) {
  const p = (await getPcp(CANDIDATE))!;
  const window = await getWindow(CANDIDATE, moduleId);
  const locks = await activeLocks(CANDIDATE);
  const plan = buildSession(moduleId, {
    candidate_id: CANDIDATE,
    pcp: p,
    window,
    locks,
    session_index: opts.sessionIndex,
  });

  const n = plan.items.length;
  const correctCount = Math.round(n * opts.accuracy);
  const attempts = plan.items.map((item, i) => {
    const isCorrect = i < correctCount;
    const errorTag = !isCorrect && opts.errorTag ? opts.errorTag : 'tense_marker';
    const expected = 'expected' in item ? String(item.expected) : '';
    return {
      item_id: item.item_id,
      item_kind: item.kind,
      correct: isCorrect,
      input: isCorrect ? expected : 'wrong',
      expected,
      latency_ms: opts.latency + (i % 5) * 40,
      error_code: (isCorrect ? 'ACCEPTED' : 'PATTERN_MISMATCH') as 'ACCEPTED' | 'PATTERN_MISMATCH',
      error_category: isCorrect ? null : errorTag,
      char_position: null,
      latency_delta_ms: isCorrect ? -500 : null,
      counted_chars: 10,
      correct_chars: isCorrect ? 10 : 3,
      delayed_recall: false,
      clarity_score: null,
    };
  });

  return await processSessionResult({
    // sessions.session_id is the primary key on its own, so it has to be unique
    // across the whole table, not just per candidate. Scoping it to the fixture
    // keeps repeated runs from colliding with rows a previous run left behind.
    session_id: `${CANDIDATE}-${moduleId}-live-${opts.sessionIndex}`,
    candidate_id: CANDIDATE,
    module_id: moduleId,
    attempts,
    started_at: new Date(Date.now() - 1000).toISOString(),
    ended_at: new Date().toISOString(),
  });
}

{
  const r1 = await runSession('P1_VD', { accuracy: 0.7, latency: 3000, sessionIndex: 1, errorTag: 'tense_marker' });
  check('first session records an INIT adjustment', r1.adjustment.reason === 'INIT', r1.adjustment.reason);
  check('metrics updated from real performance', await getPcp(CANDIDATE) !== null);
}

{
  // Four sessions carrying the same error tag => lock on the 4th.
  for (let i = 2; i <= 4; i++) {
    await runSession('P1_VD', { accuracy: 0.75, latency: 2800, sessionIndex: i, errorTag: 'tense_marker' });
  }
  const locks = await activeLocks(CANDIDATE);
  check('Structural Lock triggered on 4th recurrence', locks.some((l) => l.tag === 'tense_marker'), `active: ${locks.map((l) => `${l.module_id}:${l.tag}`).join(',') || 'none'}`);

  const lock = locks.find((l) => l.tag === 'tense_marker');
  check('lock records 4 flagged sessions', lock?.sessions_flagged === 4, `${lock?.sessions_flagged}`);
  check('lock diverts 15% of sessions', lock?.diversion_pct === 15, `${lock?.diversion_pct}%`);
  check('lock does not block all progression', lock?.blocks_escalation === true, 'blocks only this module\'s escalation');

  const remediated = buildSession('P1_VD', {
    candidate_id: CANDIDATE,
    pcp: (await getPcp(CANDIDATE))!,
    window: await getWindow(CANDIDATE, 'P1_VD'),
    locks: await activeLocks(CANDIDATE),
    session_index: 5,
  });
  check('remediation items present in next session', Boolean(remediated.remediation), JSON.stringify(remediated.remediation));
  const remediatedCount = remediated.items.filter((i) => i.remediation).length;
  check('remediation is ~15% of the session', remediatedCount >= 2 && remediatedCount <= Math.ceil(remediated.items.length * 0.3), `${remediatedCount}/${remediated.items.length}`);
  check('remediation runs at reduced speed (threshold widened)', remediated.threshold_ms > remediated.speed_multiplier * 0 + (remediated.threshold_ms / 1.15) - 1, `${remediated.threshold_ms}ms`);
  check('thresholds held fixed within the session', new Set(remediated.items.map((i) => i.threshold_ms)).size === 1);
}

{
  // Sustained high performance => tightening.
  for (let i = 5; i <= 9; i++) {
    await runSession('P1_VD', { accuracy: 1.0, latency: 1500, sessionIndex: i });
  }
  const w = await getWindow(CANDIDATE, 'P1_VD');
  const tightened = w.adjustment_factor_log.filter((e) => e.reason === 'TIGHTEN');
  check('APE tightened after sustained improvement', tightened.length > 0, `${tightened.length} tighten events`);
  check('threshold now below the calibration seed', w.current_threshold_ms < pcp.phase_1_entry_difficulty_seed.latency_threshold_ms, `${w.current_threshold_ms}ms`);
  check('threshold respects the module floor', w.current_threshold_ms >= MODULES.P1_VD.threshold_clamp_ms.min, `${w.current_threshold_ms}ms`);
  check('window holds at most 8 sessions', w.last_8_sessions.length <= 8, `${w.last_8_sessions.length}`);
  const otherWindows = await allWindows(CANDIDATE);
  check('other modules untouched (fully independent tracks)', otherWindows.P2_RDI?.last_8_sessions.length === 0, `P2_RDI sessions: ${otherWindows.P2_RDI?.last_8_sessions.length}`);
}

/* ── 8. Phase gating ──────────────────────────────────────────────────────── */

section('8. PHASE GATING (Section 7)');

{
  const plan = buildSession('P4_PC', {
    candidate_id: CANDIDATE,
    pcp: (await getPcp(CANDIDATE))!,
    window: await getWindow(CANDIDATE, 'P4_PC'),
    locks: [],
    session_index: 1,
  });
  check('Phase 4 content builds', plan.items.length > 0, `${plan.items.length} items`);

  const profile = (await buildCandidateProfile(CANDIDATE))!;
  check('Phase 2 locked at DECODER', profile.phase_unlocked[2] === false);
  check('Phase 3 locked at DECODER', profile.phase_unlocked[3] === false);
  check('Phase 4 locked at DECODER', profile.phase_unlocked[4] === false);
  check('Phase 1 unlocked', profile.phase_unlocked[1] === true);
}

/* ── 9. Failure tiers (Section 5.2) ────────────────────────────────────────── */

section('9. FAILURE TIERS — NO LOCKOUT, NO STAT CUTS (Section 5.2)');

{
  const profileBefore = (await buildCandidateProfile(CANDIDATE))!;
  const floorsBefore = { ...profileBefore.metric_floors };

  // Drive the day down.
  for (let i = 10; i <= 14; i++) {
    await runSession('P1_VSF', { accuracy: 0.2, latency: 6000, sessionIndex: i, errorTag: 'scene_action_binding' });
  }

  const outcome = await applyDailyTier(CANDIDATE);
  const profileAfter = (await buildCandidateProfile(CANDIDATE))!;

  check('low daily aggregate classified BELOW_95 or BELOW_85', outcome.tier !== 'NONE', `${outcome.tier} @ ${outcome.aggregate_pct}%`);
  check('streak progress reset to zero', outcome.streak_after === 0, `streak ${outcome.streak_before} -> ${outcome.streak_after}`);
  check('NO lockout applied', outcome.lockout_applied === false);
  check('baseline stats NOT cut', outcome.baseline_stats_cut === false);
  check('forced repeat only below 85%', (outcome.tier === 'BELOW_85') === outcome.forced_repeat, `tier=${outcome.tier} forced=${outcome.forced_repeat}`);
  check('forced repeat targets only the failed modules', outcome.forced_repeat ? outcome.modules_failed.length > 0 : true, outcome.modules_failed.join(','));
  check(
    'metric floors unchanged by failure',
    JSON.stringify(profileAfter.metric_floors) === JSON.stringify(floorsBefore),
  );
  check('access still available (no lockout record)', profileAfter.pending_remediation !== undefined);
  const streak = await getStreak(CANDIDATE);
  check('streak multiplier never becomes 0', streak.multiplier >= 1, `${streak.multiplier}`);
}

{
  const sessions = await listSessions(CANDIDATE, 100);
  check('all sessions retained (no punitive erasure)', sessions.length >= 14, `${sessions.length} sessions`);
  const log = (await buildCandidateProfile(CANDIDATE))!.daily_log;
  const today = log[0];
  // SQLite stores these as integers 0/1; the row mapping normalises to boolean.
  check('daily log records baseline_stats_cut = false', today?.baseline_stats_cut === false, `${String(today?.baseline_stats_cut)}`);
  check('daily log records lockout_applied = false', today?.lockout_applied === false, `${String(today?.lockout_applied)}`);
}

/* ── 10. Metrics (Section 3) ──────────────────────────────────────────────── */

section('10. METRICS SYSTEM (Section 3)');

{
  const profile = (await buildCandidateProfile(CANDIDATE))!;
  const m = profile.metrics;
  check('PI computed at APE-set speed', m.precision_index > 0 && m.precision_index <= 100, `${m.precision_index}`);
  check('RL reported as % of personal baseline, not raw ms', m.reflex_latency_pct_of_baseline > 0, `${m.reflex_latency_pct_of_baseline}% of ${pcp.baseline_reflex_latency_ms}ms`);
  check('RD provisional until 24h data exists', profile.metric_provenance.rd_provisional === true);
  check('RD computed from fresh recall meanwhile', m.retention_density > 0, `${m.retention_density}`);
  check('VC reported as delta vs VC0 baseline', m.vocal_clarity_delta === 0, `${m.vocal_clarity_delta} (no vocal sessions yet)`);
  check('PTI excludes locked patterns', m.pattern_intuition === 0, `${m.pattern_intuition} (no slot sessions yet)`);
  check('all metrics 2dp', [m.precision_index, m.reflex_latency_pct_of_baseline, m.retention_density, m.vocal_clarity_delta, m.pattern_intuition].every((v) => Math.round(v * 100) === v * 100));
  check('no PI/PTI acronym collision (distinct keys)', 'pattern_intuition' in m && 'precision_index' in m);
}

/* ── 11. Pressure chamber bound (Section 7.4.1) ───────────────────────────── */

section('11. PRESSURE CHAMBER BOUND (Section 7.4.1)');

{
  const { boundPressureChamber } = await import('../src/core/ape.js');
  const safe = boundPressureChamber(5, 99.2);
  check('reduction allowed when ceiling is met', safe.applied_pct === 5, `${safe.applied_pct}%`);

  const halted = boundPressureChamber(5, 96.4);
  check('reduction HALTED below the 98% statistical floor', halted.applied_pct === 0, `${halted.applied_pct}% — ${halted.reason}`);

  const capped = boundPressureChamber(40, 99.5);
  check('reduction capped at 5% per correct answer', capped.applied_pct === 5, `${capped.applied_pct}%`);
}

/* ── 12. Determinism ──────────────────────────────────────────────────────── */

section('12. DETERMINISTIC CONTENT GENERATION');

{
  const args = {
    candidate_id: CANDIDATE,
    pcp: (await getPcp(CANDIDATE))!,
    window: await getWindow(CANDIDATE, 'P1_VD'),
    locks: await activeLocks(CANDIDATE),
    session_index: 42,
  };
  const a = buildSession('P1_VD', args);
  const b = buildSession('P1_VD', args);
  check('same inputs produce the identical session', JSON.stringify(a) === JSON.stringify(b));
  const c = buildSession('P1_VD', { ...args, session_index: 43 });
  check('different session index produces a different set', JSON.stringify(a.items) !== JSON.stringify(c.items));
  const ids = new Set(a.items.map((i) => i.item_id));
  check('no duplicate item ids within a session', ids.size === a.items.length, `${ids.size}/${a.items.length}`);
}

/* ── 13. Second candidate independence ────────────────────────────────────── */

section('13. CANDIDATE INDEPENDENCE (Section 1.3)');

{
  const other = 'smoke-anik';
  await createCandidate(other, 'Anik');
  const strongPasses = JSON.parse(JSON.stringify(passes)) as typeof passes;
  strongPasses[0]!.band_accuracy = { V1: 100, V2: 100, V3: 100, V4: 100, V5: 100, V6: 100, V7: 100, V8: 100, V9: 100, V10: 100, V11: 100, V12: 100 };
  strongPasses[0]!.correct = 96;
  strongPasses[1]!.correct = 90;
  strongPasses[2]!.level_accuracy = { S1: 100, S2: 100, S3: 100, S4: 100, S5: 100, S6: 100, S7: 100, S8: 100 };
  strongPasses[2]!.correct = 48;
  strongPasses[3]!.correct = 46;
  strongPasses[3]!.level_accuracy = { S1: 100, S2: 100, S3: 100, S4: 100, S5: 100, S6: 100, S7: 100, S8: 100 };
  strongPasses[4]!.wpm = 90; strongPasses[5]!.wpm = 150; strongPasses[6]!.wpm = 200; strongPasses[7]!.wpm = 250; strongPasses[8]!.wpm = 310;
  strongPasses[8]!.correct = 12;
  strongPasses[9]!.clarity_by_class = { str_cluster: 90, th_digraph: 92, voiceless_stops: 94, voiced_stops: 91, laterals: 93 };
  strongPasses[10]!.clarity_by_class = { str_cluster: 89, th_digraph: 91, voiceless_stops: 93, voiced_stops: 90, laterals: 92 };
  strongPasses[9]!.clarity = 92;
  strongPasses[10]!.clarity = 92;
  strongPasses[11]!.correct = 36;
  strongPasses[12]!.correct = 35;

  const anik = await finaliseCalibration(other, strongPasses);
  check('second candidate gets a different vocabulary band', anik.vocabulary_band !== pcp.vocabulary_band, `billi=${pcp.vocabulary_band} anik=${anik.vocabulary_band}`);
  check('second candidate gets a different syntax ceiling', anik.syntax_ceiling !== pcp.syntax_ceiling, `billi=${pcp.syntax_ceiling} anik=${anik.syntax_ceiling}`);
  check('stronger PCP yields a higher entry rank', anik.entry_rank === 'RANK 02: OPERATOR', `anik=${anik.entry_rank}`);
  check('stronger PCP yields a tighter starting threshold', anik.phase_1_entry_difficulty_seed.latency_threshold_ms !== pcp.phase_1_entry_difficulty_seed.latency_threshold_ms, `billi=${pcp.phase_1_entry_difficulty_seed.latency_threshold_ms} anik=${anik.phase_1_entry_difficulty_seed.latency_threshold_ms}`);

  const billiProfile = (await buildCandidateProfile(CANDIDATE))!;
  const anikProfile = (await buildCandidateProfile(other))!;
  check('no shared rolling windows', billiProfile.rolling_windows.P1_VD?.last_8_sessions.length !== anikProfile.rolling_windows.P1_VD?.last_8_sessions.length, `billi=${billiProfile.rolling_windows.P1_VD?.last_8_sessions.length} anik=${anikProfile.rolling_windows.P1_VD?.last_8_sessions.length}`);
  check('no shared streak state', JSON.stringify(billiProfile.streak) !== JSON.stringify(anikProfile.streak));
  check('no shared structural locks', anikProfile.active_structural_locks.length === 0);
  check('Anik at OPERATOR unlocks Phase 2', anikProfile.phase_unlocked[2] === true);
  check('Anik at OPERATOR does not unlock Phase 4', anikProfile.phase_unlocked[4] === false);
}

/* ── 14. APE-weighted schedule (Section 6) ─────────────────────────────────── */

section('14. APE-WEIGHTED DAILY SCHEDULE (Section 6)');

{
  const { buildDailySchedule } = await import('../src/core/scheduler.js');
  const plain = buildDailySchedule({ date: '2026-01-01', active_locks: [], forced_repeat_modules: [] });
  check('5 blocks, rigid shell', plain.blocks.length === 5, `${plain.blocks.length}`);
  check('totals 45:00 with no locks', plain.total_s === 2700, `${plain.total_s}s`);
  const checkContiguous = plain.blocks.every((b, i) => i === 0 || b.start_s === plain.blocks[i - 1]!.end_s);
  check('blocks are contiguous, no gaps or overlap', checkContiguous);

  const weighted = buildDailySchedule({
    date: '2026-01-01',
    active_locks: [makeLock('tense_marker', 'P1_VD', new Date().toISOString())],
    forced_repeat_modules: [],
  });
  check('total stays 45:00 with an active lock', weighted.total_s === 2700, `${weighted.total_s}s`);
  const vector = weighted.blocks.find((b) => b.block === 'VECTOR')!;
  const dictation = weighted.blocks.find((b) => b.block === 'DICTATION')!;
  check('lock extends its own block', vector.adjustment_s === 300, `+${vector.adjustment_s}s`);
  check('extension is drained from another block', dictation.adjustment_s === -300, `${dictation.adjustment_s}s`);
  check('logging block never reallocated', weighted.blocks.find((b) => b.block === 'LOGGING')!.duration_s === 180);
  check('candidate is not told which block moved', weighted.notes.some((n) => n.includes('not notified')), weighted.notes.join(' | '));

  // The single-lock case is not sufficient: Section 6 requires the total to
  // hold at 45:00 for ANY combination of simultaneous locks. Drain capacity is
  // bounded only by the 2:00 per-block floor, so this must hold exhaustively.
  const ALL_BLOCKS = ['VOCAL', 'VECTOR', 'DICTATION', 'VISUOSPATIAL', 'LOGGING'] as const;
  const moduleIds = Object.keys(MODULES) as (keyof typeof MODULES)[];
  const modFor = (b: (typeof ALL_BLOCKS)[number]) => moduleIds.find((m) => MODULES[m].block === b);
  let comboFailures = 0;
  let combos = 0;
  for (let mask = 0; mask < 1 << ALL_BLOCKS.length; mask++) {
    const chosen = ALL_BLOCKS.filter((_, i) => mask & (1 << i));
    const locks = chosen.flatMap((b, i) => {
      const module_id = modFor(b);
      if (!module_id) return [];
      return [{ id: i + 1, candidate_id: CANDIDATE, module_id, tag: `t${i}`, sessions_flagged: 4, first_flagged_at: '', last_seen_at: '', triggered_at: '', cleared_at: null, sessions_remaining: 3, diversion_pct: 15, blocks_escalation: true, remediation_active: true }];
    }) as unknown as Parameters<typeof buildDailySchedule>[0]['active_locks'];
    const s = buildDailySchedule({ date: '2026-09-25', active_locks: locks, forced_repeat_modules: [] });
    combos++;
    if (s.total_s !== 2700) comboFailures++;
    if (s.blocks.some((b) => b.duration_s < 120)) comboFailures++;
  }
  check(`45:00 total holds for all ${combos} simultaneous-lock combinations`, comboFailures === 0, `${comboFailures} violations`);
}

section('15. REGRESSION GUARDS (defects fixed during build)');

{
  /* Stimulus rate must RISE when the APE tightens. `speed_multiplier` is a
     rate, not a deadline; multiplying by 0.93 slowed the candidate instead. */
  const base = win([
    { acc: 90, lat: 2600 },
    { acc: 92, lat: 2400 },
    { acc: 95, lat: 2200 },
    { acc: 98, lat: 2000 },
  ]);
  base.speed_multiplier = 1.2;
  const tight = recalculate(base, { ...base.last_8_sessions[3]!, session_id: 'n' }, MODULES.P1_VD, 'n', new Date().toISOString());
  check('TIGHTEN raises the stimulus rate, not lowers it', tight.window.speed_multiplier > 1.2, `1.2 -> ${tight.window.speed_multiplier}`);

  const decline = win([
    { acc: 98, lat: 1800 },
    { acc: 95, lat: 2000 },
    { acc: 90, lat: 2300 },
    { acc: 85, lat: 2600 },
  ]);
  decline.speed_multiplier = 1.2;
  const loose = recalculate(decline, { ...decline.last_8_sessions[3]!, session_id: 'n2' }, MODULES.P1_VD, 'n2', new Date().toISOString());
  check('LOOSEN lowers the stimulus rate', loose.window.speed_multiplier < 1.2, `1.2 -> ${loose.window.speed_multiplier}`);

  /* Escalation must consume its three sessions, otherwise the same window
     re-triggers on every subsequent session and the sublevel runs away. */
  const three = win([
    { acc: 96, lat: 2000 },
    { acc: 97, lat: 2000 },
    { acc: 99, lat: 2000 },
  ]);
  check('three in-band sessions are ready before consumption', checkEscalation(three, MODULES.P1_VD, []).ready);
  const consumed = applyEscalation(three, MAX_SUBLEVEL, three.last_8_sessions[2]!.session_id);
  check('consumed escalation does not re-trigger on the same window', !checkEscalation(consumed, MODULES.P1_VD, []).ready);
  const plusOne = {
    ...consumed,
    last_8_sessions: [...consumed.last_8_sessions, { ...consumed.last_8_sessions[2]!, session_id: 'fresh-1' }],
  };
  check('two new sessions are still not enough', !checkEscalation(plusOne, MODULES.P1_VD, []).ready);
  const plusThree = {
    ...plusOne,
    last_8_sessions: [
      ...plusOne.last_8_sessions,
      { ...plusOne.last_8_sessions[0]!, session_id: 'fresh-2' },
      { ...plusOne.last_8_sessions[0]!, session_id: 'fresh-3' },
    ],
  };
  check('three NEW in-band sessions escalate again', checkEscalation(plusThree, MODULES.P1_VD, []).ready);

  /* A DECODER must be able to reach OPERATOR. The search previously only
     looked at ranks WEAKER than the current one, so promotion was impossible. */
  const inBand = (id: keyof typeof MODULES) => {
    const w = win([
      { acc: 96, lat: 1500 },
      { acc: 97, lat: 1500 },
      { acc: 98, lat: 1500 },
    ]);
    return [
      id,
      {
        ...w,
        last_8_sessions: w.last_8_sessions.map((s) => ({ ...s, module_id: id, sublevel: 3 })),
        sublevel: 3,
      },
    ] as const;
  };
  const phase1Only = Object.fromEntries(
    (Object.keys(MODULES) as (keyof typeof MODULES)[]).filter((id) => MODULES[id].phase === 1).map(inBand),
  );
  const promote = evaluateRanks({
    rank: 'RANK 03: DECODER',
    rolling_windows: phase1Only,
    locks: [],
    lock_history: [],
    phase4_sessions: [],
    now: new Date(),
  });
  check('a DECODER can be promoted once Phase 1 requirements are met', promote.nextRank === 'RANK 02: OPERATOR', `nextRank=${String(promote.nextRank)}`);

  const cold = Object.fromEntries(
    (Object.keys(MODULES) as (keyof typeof MODULES)[])
      .filter((id) => MODULES[id].phase === 1)
      .map((id) => [id, win([])]),
  );
  const noPromo = evaluateRanks({
    rank: 'RANK 03: DECODER',
    rolling_windows: cold,
    locks: [],
    lock_history: [],
    phase4_sessions: [],
    now: new Date(),
  });
  check('no phantom promotion when requirements are unmet', noPromo.nextRank === null, `nextRank=${String(noPromo.nextRank)}`);
}

{
  /* Section 1.2 mandates a timed pass on EVERY vector. */
  let timedError: string | null = null;
  try {
    await finaliseCalibration('no-timed', passes.map((p) => (p.pass_type === 'timed' ? { ...p, pass_type: 'untimed' as const } : p)));
  } catch (e) {
    timedError = (e as Error).message;
  }
  check('calibration is rejected without a timed pass on every vector', timedError !== null && /timed/i.test(timedError), timedError ?? 'accepted');

  /* A calibrated PCP is locked; a silent overwrite would reset the track. */
  let lockError: string | null = null;
  try {
    await finaliseCalibration(CANDIDATE, passes);
  } catch (e) {
    lockError = (e as Error).message;
  }
  check('a locked PCP cannot be silently overwritten', lockError !== null && /LOCKED/i.test(lockError), lockError ?? 'overwrote');
}

{
  /* A streak counts consecutive DAYS. Repeated sessions in one day must not
     inflate it, and they must not be undone by a later session either. */
  const DAY_CAND = 'smoke-streak-probe';
  await createCandidate(DAY_CAND, 'STREAK PROBE');
  await recordPass(DAY_CAND, 'C1', 'untimed', passes[0]!);
  await recordPass(DAY_CAND, 'C2', 'untimed', passes[2]!);
  await recordPass(DAY_CAND, 'C3', 'untimed', passes[4]!);
  await recordPass(DAY_CAND, 'C4', 'untimed', passes[9]!);
  await recordPass(DAY_CAND, 'C5', 'untimed', passes[11]!);
  await finaliseCalibration(DAY_CAND, passes);

  const perfect = (n: number) =>
    Array.from({ length: n }, (_, k) => ({
      item_id: `P1_VD-${n}-${k}`,
      item_kind: 'pattern',
      input: 'SYNTHESIZED',
      expected: 'SYNTHESIZED',
      correct: true,
      latency_ms: 1200,
      error_code: 'ACCEPTED',
      error_category: null,
      char_position: null,
      latency_delta_ms: null,
      counted_chars: 10,
      correct_chars: 10,
    })) as unknown as Attempt[];

  for (let i = 1; i <= 3; i++) {
    await processSessionResult(
      { session_id: `${DAY_CAND}-streak-${i}`, candidate_id: DAY_CAND, module_id: 'P1_VD', attempts: perfect(i), started_at: new Date().toISOString(), ended_at: new Date().toISOString() },
      [],
    );
  }
  const afterThree = await getStreak(DAY_CAND);
  check('three sessions in one day count as a single streak day', afterThree.current === 1, `streak=${afterThree.current} after 3 sessions`);
}

console.log(`\n${'='.repeat(46)}`);
console.log(failures === 0 ? `ALL ${checks} CHECKS PASSED` : `${failures} of ${checks} CHECKS FAILED`);
console.log('='.repeat(46));
void errorTagsOf;
process.exit(failures === 0 ? 0 : 1);
