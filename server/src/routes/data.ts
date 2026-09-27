import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { buildDashboard } from '../service/dashboard.js';
import { historyFor, historyTotals } from '../service/history.js';
import { statsFor } from '../service/stats.js';
import { listCandidatesForTeacher, teacherDetail } from '../service/teacher.js';
import { getPcp, listSessions, readCalibrationPasses } from '../db/repo.js';
import { buildDailySchedule } from '../core/scheduler.js';
import { CALIBRATION_MANIFEST, CALIBRATION_STEP_COPY } from '../core/calibrationCopy.js';
import { plainModule } from '../core/plain.js';
import { HttpError } from '../service/httpError.js';
import { todayUtc } from '../util.js';
import { MODULES } from '../core/modules.js';
import { userRoutes } from './api.js';
import { asyncRoute } from './asyncRoute.js';
import type { ModuleId } from '../core/types.js';

export const dataRoutes = Router();

// Auth is applied per route, not router-wide: this router is mounted at /api,
// alongside the engine router, so a blanket guard here would reject those too.

/** Candidate-facing dashboard. Only ever the signed-in user's own track. */
dataRoutes.get(
  '/dashboard',
  requireAuth,
  asyncRoute(async (req, res) => {
    const id = req.user!.id;
    if (req.user!.role !== 'candidate') throw new HttpError(403, 'Teacher accounts use the observer view.');
    const schedule = buildDailySchedule({ date: todayUtc(), active_locks: [], forced_repeat_modules: [] });
    res.json(await buildDashboard(id, req.user!.display_name, schedule.total_s));
  }),
);

/** Onboarding copy so the calibration wizard never hardcodes internal labels. */
dataRoutes.get(
  '/onboarding',
  requireAuth,
  asyncRoute(async (req, res) => {
    const id = req.user!.id;
    const pcp = await getPcp(id);
    // Which passes already exist, so a candidate who refreshes mid-calibration
    // resumes instead of restarting. Without this the wizard began at C1 every
    // time, and a refresh after two vectors silently re-recorded them, so a
    // partial re-run superseded the passes already on file. Only the pair is
    // exposed: no scores, no bands, no levels, nothing for the candidate to read
    // as a result.
    const recorded = await readCalibrationPasses(id);
    res.json({
      calibrated: pcp?.locked === true,
      steps: CALIBRATION_STEP_COPY,
      manifest_version: CALIBRATION_MANIFEST.version,
      recorded_passes: recorded.map((r) => ({ vector: r.vector, pass_type: r.pass_type })),
    });
  }),
);

/** Plain-language module list for the candidate's drill picker. */
dataRoutes.get(
  '/practice',
  requireAuth,
  asyncRoute(async (req, res) => {
    const id = req.user!.id;
    const recent = await listSessions(id, 50);
    res.json({
      modules: (Object.keys(MODULES) as ModuleId[]).map((m) => {
        const mine = recent.filter((s) => s.module_id === m);
        return {
          id: m,
          label: plainModule(m),
          phase: MODULES[m].phase,
          block: MODULES[m].block,
          sessions: mine.length,
          accuracy_pct: mine.length
            ? Number((mine.reduce((a, s) => a + s.accuracy_pct, 0) / mine.length).toFixed(2))
            : null,
        };
      }),
    });
  }),
);

/* ── Section 13.3: user-scoped candidate surface ────────────────────────────
 *
 * Mounted at /api, so these paths are /api/calibration/probe, /api/session/next
 * and so on. The subject is always the session cookie: no candidate id appears
 * in any URL the UI can construct. Calibration, profile, schedule and session
 * operations share one implementation with the engine's `/candidates/:id/...`
 * routes — see the route table in api.ts.
 */

/**
 * Section 13.4 HISTORY. Every attempted quest with its full per-attempt record,
 * newest first. Read-only by construction, and scoped to the signed-in user.
 */
dataRoutes.get(
  '/history',
  requireAuth,
  asyncRoute(async (req, res) => {
    const id = req.user!.id;
    if (req.user!.role !== 'candidate') throw new HttpError(403, 'Teacher accounts use the observer view.');
    const moduleParam = typeof req.query['module'] === 'string' ? (req.query['module'] as ModuleId) : undefined;
    const page = await historyFor(id, {
      limit: Number(req.query['limit'] ?? 25),
      offset: Number(req.query['offset'] ?? 0),
      moduleId: moduleParam,
    });
    res.json({ ...page, totals: await historyTotals(id) });
  }),
);

/** Section 13.5 STATS: green/red movement, strengths, weaknesses, rank impact. */
dataRoutes.get(
  '/stats',
  requireAuth,
  asyncRoute(async (req, res) => {
    const id = req.user!.id;
    if (req.user!.role !== 'candidate') throw new HttpError(403, 'Teacher accounts use the observer view.');
    res.json(await statsFor(id));
  }),
);

dataRoutes.use(userRoutes);
/* ── Section 13.6: teacher view ──────────────────────────────────────────── */

export const teacherRoutes = Router();

teacherRoutes.use(requireAuth, requireRole('admin'));

teacherRoutes.get(
  '/candidates',
  asyncRoute(async (_req, res) => {
    res.json({ candidates: await listCandidatesForTeacher() });
  }),
);

teacherRoutes.get(
  '/candidates/:id',
  asyncRoute(async (req, res) => {
    res.json(await teacherDetail(req.params.id!));
  }),
);
