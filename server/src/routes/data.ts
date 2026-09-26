import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { buildDashboard } from '../service/dashboard.js';
import { listCandidatesForTeacher, teacherDetail } from '../service/teacher.js';
import { getPcp, listSessions } from '../db/repo.js';
import { buildDailySchedule } from '../core/scheduler.js';
import { CALIBRATION_MANIFEST, CALIBRATION_STEP_COPY } from '../core/calibrationCopy.js';
import { plainModule } from '../core/plain.js';
import { HttpError } from '../service/httpError.js';
import { todayUtc } from '../util.js';
import { MODULES } from '../core/modules.js';
import { userRoutes } from './api.js';
import type { ModuleId } from '../core/types.js';

export const dataRoutes = Router();

// Auth is applied per route, not router-wide: this router is mounted at /api,
// alongside the engine router, so a blanket guard here would reject those too.

/** Candidate-facing dashboard. Only ever the signed-in user's own track. */
dataRoutes.get('/dashboard', requireAuth, (req, res) => {
  const id = req.user!.id;
  if (req.user!.role !== 'candidate') throw new HttpError(403, 'Teacher accounts use the observer view.');
  const schedule = buildDailySchedule({ date: todayUtc(), active_locks: [], forced_repeat_modules: [] });
  res.json(buildDashboard(id, req.user!.display_name, schedule.total_s));
});

/** Onboarding copy so the calibration wizard never hardcodes internal labels. */
dataRoutes.get('/onboarding', requireAuth, (req, res) => {
  const id = req.user!.id;
  const pcp = getPcp(id);
  res.json({
    calibrated: pcp?.locked === true,
    steps: CALIBRATION_STEP_COPY,
    manifest_version: CALIBRATION_MANIFEST.version,
  });
});

/** Plain-language module list for the candidate's drill picker. */
dataRoutes.get('/practice', requireAuth, (req, res) => {
  const id = req.user!.id;
  const recent = listSessions(id, 50);
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
});

/* ── Section 13.3: user-scoped candidate surface ────────────────────────────
 *
 * Mounted at /api, so these paths are /api/calibration/probe, /api/session/next
 * and so on. The subject is always the session cookie: no candidate id appears
 * in any URL the UI can construct. Calibration, profile, schedule and session
 * operations share one implementation with the engine's `/candidates/:id/...`
 * routes — see the route table in api.ts.
 */

dataRoutes.use(userRoutes);

/* ── Section 13.6: teacher view ──────────────────────────────────────────── */

export const teacherRoutes = Router();

teacherRoutes.use(requireAuth, requireRole('admin'));

teacherRoutes.get('/candidates', (_req, res) => {
  res.json({ candidates: listCandidatesForTeacher() });
});

teacherRoutes.get('/candidates/:id', (req, res) => {
  res.json(teacherDetail(req.params.id!));
});
