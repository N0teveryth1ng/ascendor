import { Router, type Request, type Response, type NextFunction } from 'express';
import type { CandidateId, ModuleId, Pcp } from '../core/types.js';
import { asyncRoute } from './asyncRoute.js';
import { ALL_MODULE_IDS, MODULES, PHASE_UNLOCK_RANK, rankAtLeast } from '../core/modules.js';
import { buildCandidateProfile, availableModules } from '../service/profile.js';
import {
  calibrationStatus,
  ensureCandidate,
  finaliseCalibration,
  recordPass,
  requirePcp,
} from '../service/calibrationService.js';
import { buildSession, type DelayedScenePayload, type SessionPlan } from '../content/index.js';
import { planFor } from '../service/sessionPlan.js';
import {
  activeLocks,
  allWindows,
  candidateExists,
  createCandidate,
  currentRank,
  delayedRecallCandidate,
  getPcp,
  getWindow,
  listCandidates,
  listSessions,
  lockHistory,
  openRemediations,
  phaseSessions,
  sessionSummaries,
} from '../db/repo.js';
import { GateError, applyDailyTier, processSessionResult } from '../service/sessionService.js';
import { buildDailyRoutine, rejectModuleParam, resolveStepModule } from '../service/dailyRoutine.js';
import { assertVocabularyItems, buildC1Items, C1_ITEMS_PER_BAND } from '../content/calibrationC1.js';
import { assertSyntaxItems, buildC2Items, C2_ITEMS_PER_LEVEL } from '../content/calibrationC2.js';
import { buildArchiveRows, recordExerciseAttempts } from '../service/exerciseArchive.js';
import { buildDailySchedule } from '../core/scheduler.js';
import { evaluateRanks, MASTER_WINDOW_DAYS } from '../core/ranks.js';
import type { Attempt } from '../core/types.js';
import { BAND_ORDER, VOCAB_BANDS } from '../content/vocab.js';
import { SYNTAX_LEVELS, SYNTAX_TASKS } from '../content/syntax.js';
import { AURAL_ACCURACY_FLOOR_PCT, AURAL_LADDER_WPM, AURAL_PROBES, DICTATION_ITEMS } from '../content/dictation.js';
import { PATTERN_ITEMS, SLOT_ITEMS } from '../content/patterns.js';
import { SCENES } from '../content/scenes.js';
import { MICROTEXTS, STREAMS } from '../content/comprehension.js';
import { BURST_GROUPS, VOCAL_PASSAGES } from '../content/vocal.js';
import { CALIBRATION_MANIFEST } from '../core/calibration.js';
import { LEGEND } from '../core/errorTags.js';
import { todayUtc } from '../util.js';
import { round2 } from '../core/ape.js';

export const api = Router();

/* ── System metadata ──────────────────────────────────────────────────────── */

api.get('/meta', (_req, res) => {
  res.json({
    system: 'THE FORGE',
    version: '2.0.0',
    voice: 'cold-clinical',
    error_taxonomy: LEGEND,
    calibration_vectors: CALIBRATION_MANIFEST,
    modules: ALL_MODULE_IDS.map((id) => ({
      ...MODULES[id],
      unlock_rank: PHASE_UNLOCK_RANK[MODULES[id].phase],
    })),
    thresholds: {
      daily_streak_pct: 95,
      daily_forced_repeat_pct: 85,
      lockouts_applied: false,
      baseline_stat_cuts: false,
    },
    content_counts: {
      vocab_bands: Object.keys(VOCAB_BANDS).length,
      vocab_words: Object.values(VOCAB_BANDS).reduce((a, b) => a + b.words.length, 0),
      syntax_tasks: SYNTAX_TASKS.length,
      pattern_items: PATTERN_ITEMS.length,
      slot_items: SLOT_ITEMS.length,
      scenes: SCENES.length,
      microtexts: MICROTEXTS.length,
      streams: STREAMS.length,
      dictation_items: DICTATION_ITEMS.length,
      vocal_passages: VOCAL_PASSAGES.length,
      burst_groups: Object.keys(BURST_GROUPS).length,
    },
  });
});

/* ── Candidates ───────────────────────────────────────────────────────────── */

async function loadCandidate(candidateId: CandidateId): Promise<void> {
  await ensureCandidate(candidateId);
}

/**
 * Route params widen to ParamsDictionary once extra middleware is present on the
 * route, so every read goes through this and stays a validated CandidateId.
 *
 * The same handlers are mounted twice: once on `/candidates/:id/...` where the
 * id is a parameter that `requireSelf` checks against the session, and once on
 * the user-scoped paths where there is no parameter at all and the session user
 * is the only possible subject. Falling back to the session here is what lets
 * one implementation serve both without duplicating a single line of logic.
 */
function ownId(req: Request): CandidateId {
  const raw = req.params['id'];
  if (typeof raw === 'string' && raw) return raw as CandidateId;
  const fromSession = req.user?.id;
  if (fromSession) return fromSession as CandidateId;
  throw new HttpError(400, 'missing candidate id');
}

/* ── Calibration (Phase 0 hard gate) ───────────────────────────────────────── */

/* Handlers below are written once and mounted twice: on `/candidates/:id/...`
   with requireSelf, and on the user-scoped path with requireAuth. Both resolve
   the subject through ownId, so there is no second copy of the logic to keep in
   sync. See ownId. */

async function handleCalibrationStatus(req: Request, res: Response): Promise<void> {
  const id = ownId(req);
  await loadCandidate(id);
  res.json(await calibrationStatus(id));
}

function handleCalibrationBatteryRoute(req: Request, res: Response): void {
  ownId(req);
  res.json(calibrationBattery());
}

/**
 * Vector -> content for C2-C5. Server-owned: the client used to hold this map,
 * which is how C1 ended up pointing at a slot-reasoning module. C1 does not
 * appear here because it is served from the vocabulary bank, not a module.
 */
const CALIBRATION_PROBE_MODULE: Record<string, ModuleId> = {
  C3: 'P3_HVS',
  C4: 'P1_VM',
  C5: 'P2_RDI',
};

/**
 * Response window for a calibration pass. Mirrors the probe profile's pressure
 * so the synthetic C1/C2 plans and the module-backed C3-C5 plans tighten by the
 * same amount on the timed pass. Not a real APE threshold: these values are
 * fixed probe constants because a candidate has no PCP yet.
 */
const CALIBRATION_PRESSURE: Record<'untimed' | 'timed', { thresholdMs: number }> = {
  untimed: { thresholdMs: 2400 },
  timed: { thresholdMs: 1440 },
};

/**
 * A synthetic plan for the vectors served from their own banks. C1 and C2 have
 * no drill module, so there is no descriptor to build a real SessionPlan from.
 * Nothing is persisted against it and nothing scored on it reaches a metric, a
 * threshold, or a rank; it is a carrier for the items.
 */
function probePlan(
  vector: string,
  passType: 'untimed' | 'timed',
  thresholdMs: number,
  items: unknown[],
): SessionPlan {
  return {
    session_id: `probe-${vector}-${passType}`,
    module_id: `${vector}_CALIBRATION`,
    phase: 1,
    sublevel: 1,
    item_count: items.length,
    threshold_ms: thresholdMs,
    speed_multiplier: 1,
    params: { flash_duration_ms: null, display_ms: null, swap_interval_ms: null, wpm: null },
    items,
  } as unknown as SessionPlan;
}

/**
 * Battery item source for a fresh, uncalibrated candidate.
 *
 * This is the one session-plan path that is deliberately NOT PCP-gated: the
 * calibration battery is what produces the PCP, so requiring one here would make
 * calibration unreachable and Onboarding's Start button a dead end. It builds a
 * plan against a neutral, never-persisted probe profile and writes no engine
 * state — grading still comes exclusively from the recorded passes.
 *
 * Served by VECTOR, not by module. The client used to name a module per vector
 * and that indirection is what let C1 be wired to P3_SSM, serving APE rule text
 * as a vocabulary probe. The vector-to-content mapping now lives here, in one
 * place, and C1 is guarded so non-vocabulary content cannot be served at all.
 */
async function handleCalibrationProbe(req: Request, res: Response): Promise<void> {
  const id = ownId(req);
  await loadCandidate(id);

  const vector = String(req.query.vector ?? '');
  if (!['C1', 'C2', 'C3', 'C4', 'C5'].includes(vector)) {
    throw new HttpError(400, 'vector must be C1|C2|C3|C4|C5');
  }
  const passType = req.query.pass_type === 'timed' ? 'timed' : 'untimed';
  const thresholdMs = Math.round(CALIBRATION_PRESSURE[passType].thresholdMs);

  // C1 and C2 are served from their own authored banks rather than from a drill
  // module, because no module measures either one: the syntax bank had no item
  // constructor at all, and the vocabulary bank has no module. Both are guarded
  // at the boundary, so a payload that is not what it claims to be 500s here
  // instead of reaching a candidate screen.
  if (vector === 'C1' || vector === 'C2') {
    const items =
      vector === 'C1'
        ? buildC1Items(id, passType, thresholdMs)
        : buildC2Items(id, thresholdMs);
    if (vector === 'C1') assertVocabularyItems(items, 'GET /calibration/probe?vector=C1');
    else assertSyntaxItems(items, 'GET /calibration/probe?vector=C2');
    res.json({ plan: probePlan(vector, passType, thresholdMs, items) });
    return;
  }

  // C3-C5 keep their module-backed content for now; the audit found C3/C5 not
  // using their authored battery content, which is tracked separately rather than
  // rewritten blind. The mapping is server-owned from here on, so those move
  // without another client change. The pass type now reaches the probe profile,
  // so the timed pass is genuinely faster and tighter than the untimed one.
  const moduleId = CALIBRATION_PROBE_MODULE[vector]!;
  const { plan } = await planFor(id, moduleId, { gated: false, passType });
  res.json({ plan });
}

/**
 * The full calibration battery, served once. Untimed-first on every vector
 * per Section 1.2 — the client runs the untimed pass before the timed one.
 */
function calibrationBattery() {
  return {
    manifest: CALIBRATION_MANIFEST,
    vectors: {
      C1: {
        name: 'LEXICAL RANGE',
        method: 'recognition + production across 12 frequency-banded word sets',
        bands: BAND_ORDER.map((b) => ({ band: b, ...VOCAB_BANDS[b] })),
        // One word per band. This advertises 8 while serving a different count,
        // so the vector's own description disagreed with the pass the candidate
        // was asked to complete.
        items_per_band: C1_ITEMS_PER_BAND,
        item_count: BAND_ORDER.length * C1_ITEMS_PER_BAND,
      },
      C2: {
        name: 'SYNTAX CEILING',
        method: 'progressive construction until first structural failure',
        levels: SYNTAX_LEVELS,
        // The pass is one authored construction per level. Previously this entry
        // advertised the full 48-task bank while the probe served 12 unrelated
        // word-choice pairs, so the description and the measurement disagreed.
        items_per_level: C2_ITEMS_PER_LEVEL,
        item_count: SYNTAX_LEVELS.length * C2_ITEMS_PER_LEVEL,
        tasks: SYNTAX_TASKS,
      },
      C3: {
        name: 'AURAL PROCESSING SPEED',
        method: 'audio at increasing WPM; find where accuracy drops below 90%',
        ladder: AURAL_LADDER_WPM,
        accuracy_floor_pct: AURAL_ACCURACY_FLOOR_PCT,
        probes: AURAL_PROBES,
      },
      C4: {
        name: 'ARTICULATION BASELINE',
        method: 'read-aloud scored for clarity, not accent',
        passages: VOCAL_PASSAGES.filter((p) => p.tier === 1),
        burst_groups: BURST_GROUPS,
      },
      C5: {
        name: 'ORTHOGRAPHIC REFLEX',
        method: 'untimed dictation for the accuracy ceiling, then same content at speed',
        items: DICTATION_ITEMS,
      },
    },
  };
}

async function handleRecordPass(req: Request, res: Response): Promise<void> {
  const id = ownId(req);
  await loadCandidate(id);
  const vector = String(req.body?.vector ?? '');
  const passType = String(req.body?.pass_type ?? '');
  if (!['C1', 'C2', 'C3', 'C4', 'C5'].includes(vector)) throw new HttpError(400, 'unknown vector');
  if (!['untimed', 'timed'].includes(passType)) throw new HttpError(400, 'pass_type must be untimed|timed');
  await recordPass(id, vector, passType as 'untimed' | 'timed', {
    correct: Number(req.body?.correct ?? 0),
    total: Number(req.body?.total ?? 0),
    mean_latency_ms: Number(req.body?.mean_latency_ms ?? 0),
    wpm: req.body?.wpm === undefined || req.body?.wpm === null ? undefined : Number(req.body.wpm),
    band_accuracy: req.body?.band_accuracy,
    level_accuracy: req.body?.level_accuracy,
    clarity_by_class: req.body?.clarity_by_class,
    clarity: req.body?.clarity === undefined || req.body?.clarity === null ? undefined : Number(req.body.clarity),
  });
  res.json({ recorded: true, vector, pass_type: passType });
}

async function handleFinalise(req: Request, res: Response): Promise<void> {
  const id = ownId(req);
  await loadCandidate(id);
  // The PCP is derived from the candidate's recorded passes. A body carrying its
  // own numbers is rejected rather than ignored, so a client cannot believe it
  // supplied the data when the server actually ignored it.
  if (Array.isArray(req.body?.passes)) {
    res.status(400).json({
      error:
        'Passes are not accepted here. The PCP is derived from the passes recorded for this candidate, ' +
        'each validated when it was recorded. Submit the vector results through the calibration probe first.',
    });
    return;
  }
  const pcp = await finaliseCalibration(id, { recalibrate: req.body?.recalibrate === true });
  res.json({ pcp, profile: await buildCandidateProfile(id) });
}

/* ── Profile & dashboard ──────────────────────────────────────────────────── */

async function handleProfile(req: Request, res: Response): Promise<void> {
  const id = ownId(req);
  await loadCandidate(id);
  const profile = await buildCandidateProfile(id);
  if (!profile) throw new HttpError(404, 'profile unavailable');
  res.json({
    profile,
    modules: availableModules(profile),
    sessions: await listSessions(id, 40),
    schedule: buildDailySchedule({
      date: todayUtc(),
      active_locks: profile.active_structural_locks,
      forced_repeat_modules: profile.pending_remediation,
    }),
  });
}

async function handleSchedule(req: Request, res: Response): Promise<void> {
  const id = ownId(req);
  await loadCandidate(id);
  const profile = await buildCandidateProfile(id);
  const moduleIds = Object.keys(MODULES) as ModuleId[];
  // Rank requirements ride along with the schedule: both are read-only views
  // of the same candidate state, so the UI needs one call, not two.
  const [locks, remediations, windows, history, phase4, rank] = await Promise.all([
    profile ? Promise.resolve(profile.active_structural_locks) : activeLocks(id),
    openRemediations(id),
    Promise.all(moduleIds.map((m) => getWindow(id, m))),
    lockHistory(id),
    phaseSessions(id, 4, Date.now() - MASTER_WINDOW_DAYS * 86400000),
    currentRank(id),
  ]);
  res.json({
    ...buildDailySchedule({
      date: todayUtc(),
      active_locks: locks,
      forced_repeat_modules: remediations,
    }),
    rank_evaluation: evaluateRanks({
      rank,
      rolling_windows: Object.fromEntries(moduleIds.map((m, i) => [m, windows[i]!])),
      locks,
      lock_history: history,
      phase4_sessions: phase4,
      now: new Date(),
    }),
  });
}

api.post(
  '/candidates/:id/daily-log',
  requireSelf,
  asyncRoute(async (req, res) => {
    const id = ownId(req);
    await loadCandidate(id);
    res.json(await applyDailyTier(id));
  }),
);

/* ── Session lifecycle ────────────────────────────────────────────────────── */

/**
 * Section 16.3: today's routine, as an ordered list of steps. This is the only
 * entry point to drill content — there is deliberately no "list modules" route
 * and no per-module plan route, because either would be a way to choose.
 */
async function handleRoutine(req: Request, res: Response): Promise<void> {
  const id = ownId(req);
  await loadCandidate(id);
  rejectModuleParam(req.query.module);

  const routine = await buildDailyRoutine(id, todayUtc());
  const schedule = await buildDailySchedule({
    date: routine.date,
    active_locks: await activeLocks(id),
    forced_repeat_modules: routine.steps.flatMap((s) => s.modules.filter((m) => m.lock_driven).map((m) => m.module_id)),
  });

  res.json({ routine, schedule, pcp_summary: pcpSummary((await getPcp(id))!) });
}

async function handleSessionNext(req: Request, res: Response): Promise<void> {
  const id = ownId(req);
  await loadCandidate(id);

  // Section 16.1: the client cannot choose a module. Reject rather than ignore,
  // so a stale or hand-written client cannot believe it selected one.
  rejectModuleParam(req.query.module);

  const routine = await buildDailyRoutine(id, todayUtc());

  // `?step=N&m=K` counts through the routine the server already built. Neither
  // value can introduce a module: see resolveStepModule.
  const { step, module } = resolveStepModule(routine, Number(req.query.step ?? 1), Number(req.query.m ?? 1));

  const { plan, recall_of_session, recall_payload } = await planFor(id, module.module_id, { gated: true });

  res.json({
    step,
    module,
    routine,
    plan,
    recall_of_session,
    recall_payload,
    pcp_summary: pcpSummary((await getPcp(id))!),
  });
}

function pcpSummary(pcp: Pcp) {
  return {
    vocabulary_band: pcp.vocabulary_band,
    syntax_ceiling: pcp.syntax_ceiling,
    baseline_reflex_latency_ms: pcp.baseline_reflex_latency_ms,
    baseline_vocal_clarity: pcp.baseline_vocal_clarity,
    typo_vulnerability_index: pcp.typo_vulnerability_index,
    entry_rank: pcp.entry_rank,
  };
}

async function handleSubmitSession(req: Request, res: Response): Promise<void> {
  const id = ownId(req);
  await loadCandidate(id);
  await requirePcp(id);

  // Same rule as the plan route, and for the same reason: a client that posts
  // results directly must not be able to name the module they are credited to.
  // Refusing beats ignoring — an ignored module_id would still let a client
  // believe it chose, while the engine graded something else.
  rejectModuleParam(req.body?.module_id);

  const routine = await buildDailyRoutine(id, todayUtc());
  const { step, module } = resolveStepModule(routine, Number(req.body?.step ?? 1), Number(req.body?.m ?? 1));
  const moduleId = module.module_id;

  const { plan, recall_of_session, recall_payload } = await planFor(id, moduleId, { gated: true });

  const attempts = Array.isArray(req.body?.attempts) ? (req.body.attempts as Attempt[]) : [];
  if (!attempts.length) throw new HttpError(400, 'attempts[] required');

  // Phase gating must hold on submission too, not just on plan retrieval:
  // otherwise a client that skips /session/next could post results directly.
  const descriptor = MODULES[moduleId];
  const required = PHASE_UNLOCK_RANK[descriptor.phase];
  if (required !== null && !rankAtLeast(await currentRank(id), required)) {
    throw new HttpError(423, `PHASE ${descriptor.phase} LOCKED — requires ${required}`);
  }

  const sessionId = String(req.body?.session_id ?? `S-${id}-${moduleId}-${Date.now()}`);
  const result = await processSessionResult(
    {
      session_id: sessionId,
      candidate_id: id,
      module_id: moduleId,
      attempts,
      started_at: String(req.body?.started_at ?? new Date().toISOString()),
      ended_at: String(req.body?.ended_at ?? new Date().toISOString()),
      block_id: step.block,
      delayed_recall_of: req.body?.delayed_recall_of ?? null,
    },
    Array.isArray(req.body?.item_payloads) ? req.body.item_payloads : [],
  );

  // Section 13.4: append-only archive, written after the engine has graded.
  // This cannot influence the result above.
  const itemPayloads = Array.isArray(req.body?.item_payloads) ? req.body.item_payloads : [];
  await recordExerciseAttempts(
    buildArchiveRows({ userId: id, sessionId, moduleId, attempts, timestamp: new Date().toISOString(), itemPayloads }),
  );

  res.json({
    result,
    step,
    module,
    routine,
    profile: await buildCandidateProfile(id),
    recall_of_session,
    recall_payload,
    plan,
  });
}

/* ── Route table ────────────────────────────────────────────────────────────
 *
 * `userRoutes` is the addressable surface for the candidate UI: the subject is
 * the session cookie, never a URL segment. `api` keeps the `/candidates/:id/...`
 * form for the engine suite, which still addresses candidates explicitly, and
 * both share one handler per operation.
 */

export const userRoutes = Router();

/** Method, session-scoped path, legacy path, handler. */
const USER_ROUTES: Array<
  [string, string, string, (req: Request, res: Response) => void | Promise<void>]
> = [
  ['get', '/calibration', '/candidates/:id/calibration', handleCalibrationStatus],
  ['get', '/calibration/battery', '/candidates/:id/calibration/battery', handleCalibrationBatteryRoute],
  ['get', '/calibration/probe', '/candidates/:id/calibration/probe', handleCalibrationProbe],
  ['post', '/calibration/passes', '/candidates/:id/calibration/passes', handleRecordPass],
  ['post', '/calibration/finalise', '/candidates/:id/calibration/finalise', handleFinalise],
  ['get', '/profile', '/candidates/:id/profile', handleProfile],
  ['get', '/schedule', '/candidates/:id/schedule', handleSchedule],
  ['get', '/routine', '/candidates/:id/routine', handleRoutine],
  ['get', '/session/next', '/candidates/:id/session/next', handleSessionNext],
  ['post', '/session', '/candidates/:id/session', handleSubmitSession],
];

/**
 * A session-scoped candidate surface still has to be a candidate: an admin
 * session has no candidate track, so it must be refused rather than fall
 * through to a subject that does not exist for it.
 */
const requireCandidateSession = [requireAuth, requireRole('candidate')] as const;

for (const [method, path, legacyPath, handler] of USER_ROUTES) {
  const wrapped = asyncRoute(handler);
  userRoutes[method as 'get'](path, ...requireCandidateSession, wrapped);
  api[method as 'get'](legacyPath, requireSelf, wrapped);
}

/* ── Inspection endpoints ─────────────────────────────────────────────────── */

api.get(
  '/candidates/:id/windows',
  requireSelf,
  asyncRoute(async (req, res) => {
    const id = ownId(req);
    await loadCandidate(id);
    res.json({ windows: await allWindows(id) });
  }),
);

api.get(
  '/candidates/:id/locks',
  requireSelf,
  asyncRoute(async (req, res) => {
    const id = ownId(req);
    await loadCandidate(id);
    res.json({ active: await activeLocks(id), remediation: await openRemediations(id) });
  }),
);

/* ── Error handling ───────────────────────────────────────────────────────── */

export { HttpError } from '../service/httpError.js';
import { HttpError } from '../service/httpError.js';
import { requireSelf, requireAuth, requireRole } from '../middleware/auth.js';

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  if (err instanceof GateError) {
    res.status(err.status).json({ error: err.message, gate: 'CALIBRATION' });
    return;
  }
  const message = err instanceof Error ? err.message : 'INTERNAL ERROR';
  // System voice: report state, do not converse.
  res.status(500).json({ error: message });
  void round2;
}
