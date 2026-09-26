/**
 * Live HTTP verification against a real running server.
 *
 * Prefer `npm run e2e --workspace server`, which boots the server for you. This
 * file is only the HTTP client half, so it can also be pointed at an
 * already-running instance with FORGE_E2E_BASE.
 */
const BASE = process.env.FORGE_E2E_BASE ?? 'http://127.0.0.1:5174/api';
const RUN = Date.now().toString(36);

let checks = 0;
let failures = 0;

function check(label: string, ok: boolean, detail = ''): void {
  checks++;
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
}

interface Res<T> {
  status: number;
  body: T;
  cookie: string;
}

async function call<T>(path: string, init?: RequestInit, cookie?: string): Promise<Res<T>> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { cookie } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const setCookie = res.headers.get('set-cookie') ?? '';
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as T, cookie: setCookie.split(';')[0] ?? '' };
}

const post = <T,>(p: string, body: unknown, cookie?: string) =>
  call<T>(p, { method: 'POST', body: JSON.stringify(body) }, cookie);

/* Synthetic but structurally complete calibration. */
function buildPasses(bandPct: number) {
  const mk = (
    vector: 'C1' | 'C2' | 'C3' | 'C4' | 'C5',
    pass_type: 'untimed' | 'timed',
    extra: Record<string, unknown> = {},
  ) => ({
    vector,
    pass_type,
    correct: 90,
    total: 100,
    mean_latency_ms: pass_type === 'untimed' ? 0 : 2200,
    ...extra,
  });
  return [
    mk('C1', 'untimed', { band_accuracy: { V1: 100, V2: 100, V3: 100, V4: 100, V5: bandPct, V6: bandPct } }),
    mk('C1', 'timed'),
    mk('C2', 'untimed', { level_accuracy: { S1: 100, S2: 100, S3: 100, S4: 100, S5: bandPct } }),
    mk('C2', 'timed'),
    mk('C3', 'untimed', { wpm: 150 }),
    mk('C3', 'timed', { wpm: 175 }),
    mk('C4', 'untimed', { clarity: 78, phoneme_classes: { str_cluster: 80, vowel_integrity: 76 } }),
    mk('C4', 'timed', { clarity: 74, phoneme_classes: { str_cluster: 76, vowel_integrity: 72 } }),
    mk('C5', 'untimed'),
    mk('C5', 'timed'),
  ];
}

console.log('\nLIVE HTTP VERIFICATION');
console.log('='.repeat(50));

/* ── public surface ───────────────────────────────────────────────────────── */

const meta = await call<{ modules: Record<string, unknown>; vectors: string[] }>('/meta');
check('GET /meta is public', meta.status === 200 && Object.keys(meta.body.modules).length > 0, `${Object.keys(meta.body.modules).length} modules`);

const anon = await call<{ error: string }>('/dashboard');
check('GET /dashboard requires auth (401)', anon.status === 401, `got ${anon.status}`);

const anonSession = await call<{ error: string }>('/candidates/anyone/session/next?module=P1_VD');
check('session/next requires auth (401)', anonSession.status === 401, `got ${anonSession.status}`);

/* ── account creation ─────────────────────────────────────────────────────── */

interface UserDto {
  id: string;
  email: string;
  display_name: string;
  role: 'candidate' | 'admin';
  calibrated: boolean;
}

const signup = await post<{ user: UserDto }>('/auth/signup', {
  email: `e2e-${RUN}@forge.local`,
  password: 'e2e-password-123',
  display_name: 'E2E PROBE',
});
check('POST /auth/signup', signup.status === 201 && !!signup.body.user?.id, `id=${signup.body.user?.id}`);
check('signup issues an httpOnly session cookie', signup.cookie.startsWith('forge_session='));

const CAND = signup.body.user.id;
const SESSION = signup.cookie;

const weak = await post<{ error: string }>('/auth/signup', {
  email: `weak-${RUN}@forge.local`,
  password: 'short',
  display_name: 'WEAK',
});
check('signup rejects a short password (400)', weak.status === 400, `got ${weak.status}`);

const dupe = await post<{ error: string }>('/auth/signup', {
  email: `e2e-${RUN}@forge.local`,
  password: 'e2e-password-123',
  display_name: 'DUPLICATE',
});
check('signup rejects a duplicate email (409)', dupe.status === 409, `got ${dupe.status}`);

const me = await call<{ user: UserDto | null }>('/auth/me', undefined, SESSION);
check('GET /auth/me returns the session user', me.status === 200 && me.body.user?.id === CAND);

const badPw = await post<{ error: string }>('/auth/signin', {
  email: `e2e-${RUN}@forge.local`,
  password: 'wrong-password',
});
check('signin rejects a wrong password (401)', badPw.status === 401, `got ${badPw.status}`);

const anonMe = await call<{ user: UserDto | null }>('/auth/me');
check('GET /auth/me is null when signed out', anonMe.status === 200 && anonMe.body.user === null);

/* ── Section 11 hard gate: no drilling before a PCP exists ────────────────── */

const gated = await call<{ error: string }>(`/candidates/${CAND}/session/next?module=P1_VD`, undefined, SESSION);
check('session/next blocked without PCP (423)', gated.status === 423, `got ${gated.status}`);

const battery = await call<{ vectors: Record<string, unknown> }>(`/candidates/${CAND}/calibration/battery`, undefined, SESSION);
check('GET calibration battery', battery.status === 200 && Object.keys(battery.body.vectors).length === 5);

for (const p of buildPasses(90)) {
  await post(`/candidates/${CAND}/calibration/passes`, p, SESSION);
}

const partial = await post<{ error: string }>(`/candidates/${CAND}/calibration/finalise`, { passes: buildPasses(90).slice(0, 8) }, SESSION);
check(
  'finalise rejects an incomplete battery (400)',
  partial.status === 400 && /CALIBRATION INCOMPLETE/.test(partial.body.error ?? ''),
  `got ${partial.status}`,
);

const fin = await post<{ pcp: { vocabulary_band: string; entry_rank: string; locked: boolean } }>(
  `/candidates/${CAND}/calibration/finalise`,
  { passes: buildPasses(90) },
  SESSION,
);
check('POST calibration/finalise', fin.status === 200, `band=${fin.body?.pcp?.vocabulary_band} rank=${fin.body?.pcp?.entry_rank}`);

const relock = await post<{ error: string }>(`/candidates/${CAND}/calibration/finalise`, { passes: buildPasses(90) }, SESSION);
check('locked PCP rejects silent overwrite (409)', relock.status === 409, `got ${relock.status}`);

/* ── cross-account isolation ──────────────────────────────────────────────── */

const other = await post<{ user: UserDto }>('/auth/signup', {
  email: `e2e-other-${RUN}@forge.local`,
  password: 'e2e-password-123',
  display_name: 'E2E OTHER',
});
const OTHER = other.cookie;
check('second account is created', other.status === 201, `got ${other.status}`);

const cross = await call<{ error: string }>(`/candidates/${CAND}/profile`, undefined, OTHER);
check("a candidate cannot read another candidate's profile (403)", cross.status === 403, `got ${cross.status}`);

const crossSession = await call<{ error: string }>(`/candidates/${CAND}/session/next?module=P1_VD`, undefined, OTHER);
check("a candidate cannot start another candidate's session (403)", crossSession.status === 403, `got ${crossSession.status}`);

const teacherAsCandidate = await call<{ error: string }>('/teacher/candidates', undefined, SESSION);
check('candidates cannot reach teacher routes (403)', teacherAsCandidate.status === 403, `got ${teacherAsCandidate.status}`);

const anonTeacher = await call<{ error: string }>('/teacher/candidates');
check('teacher routes require auth (401)', anonTeacher.status === 401, `got ${anonTeacher.status}`);

/* ── calibrated track ─────────────────────────────────────────────────────── */

const prof = await call<{ profile: { pcp: { locked: boolean }; metrics: Record<string, number> } }>(
  `/candidates/${CAND}/profile`,
  undefined,
  SESSION,
);
check('GET profile after calibration', prof.status === 200 && prof.body.profile.pcp.locked === true);
check(
  'all five metrics round to 2dp',
  Object.values(prof.body.profile.metrics).every((v) => Number.isFinite(v) && Math.round(v * 100) === v * 100),
  JSON.stringify(prof.body.profile.metrics),
);

const sched = await call<{ total_s: number; rank_evaluation: { nextRank: string | null } }>(
  `/candidates/${CAND}/schedule`,
  undefined,
  SESSION,
);
check('GET schedule totals 45:00', sched.status === 200 && sched.body.total_s === 2700, `${sched.body?.total_s}s`);
check('schedule carries rank evaluation', sched.body.rank_evaluation?.nextRank !== undefined);

const plan = await call<{ plan: { session_id: string; items: unknown[] } }>(
  `/candidates/${CAND}/session/next?module=P1_VD`,
  undefined,
  SESSION,
);
check('GET session/next unlocked after PCP', plan.status === 200 && plan.body.plan.items.length > 0, `${plan.body.plan?.items?.length} items`);

const items = plan.body.plan.items as Record<string, unknown>[];

/* Phase gating must hold on submission, not just on plan retrieval. */
const phaseSubmit = await post<{ error: string }>(
  `/candidates/${CAND}/session`,
  {
    session_id: 'phase-probe',
    module_id: 'P4_VDS',
    attempts: [{ item_id: 'x', item_kind: 'pattern', input: 'a', expected: 'a', correct: true, latency_ms: 100, error_code: 'ACCEPTED', error_category: null, char_position: null, latency_delta_ms: null, counted_chars: 1, correct_chars: 1 }],
  },
  SESSION,
);
check('POST session enforces phase gate (423)', phaseSubmit.status === 423, `got ${phaseSubmit.status}`);

const attempts = items.map((it, i) => ({
  item_id: String(it.item_id),
  item_kind: String(it.kind),
  input: 'x',
  expected: 'x',
  correct: i % 5 !== 0,
  latency_ms: 1200 + i * 40,
  error_code: i % 5 === 0 ? 'PATTERN_MISMATCH' : 'ACCEPTED',
  error_category: i % 5 === 0 ? 'tense_marker' : null,
  char_position: null,
  latency_delta_ms: -100,
  counted_chars: 10,
  correct_chars: i % 5 === 0 ? 0 : 10,
}));

/* The client sends a readable prompt for every item kind; the archive must
   store that text rather than falling back to the item id. */
const itemPayloads = items.map((it) => ({
  kind: it.kind,
  item_id: it.item_id,
  prompt: `e2e prompt for ${String(it.item_id)}`,
}));

const sub = await post<{
  result: {
    accuracy_pct: number;
    grade_log: unknown[];
    daily_tier: { tier: string; lockout_applied: boolean; baseline_stats_cut: boolean };
  };
}>(
  `/candidates/${CAND}/session`,
  {
    session_id: plan.body.plan.session_id,
    module_id: 'P1_VD',
    attempts,
    started_at: new Date().toISOString(),
    ended_at: new Date().toISOString(),
    item_payloads: itemPayloads,
  },
  SESSION,
);
check('POST session', sub.status === 200, `${sub.body?.result?.accuracy_pct?.toFixed?.(2)}%`);
check('session never applies lockout', sub.body.result?.daily_tier?.lockout_applied === false);
check('session never cuts baseline stats', sub.body.result?.daily_tier?.baseline_stats_cut === false);
check(
  'grade log is single-line per event',
  sub.body.result?.grade_log?.every((e) => !(e as { rendered: string }).rendered.includes('\n')) ?? false,
);

const after = await call<{ profile: { rolling_windows: Record<string, { last_8_sessions: unknown[] }> } }>(
  `/candidates/${CAND}/profile`,
  undefined,
  SESSION,
);
check(
  'rolling window retains the session',
  after.body.profile.rolling_windows.P1_VD?.last_8_sessions.length === 1,
  `${after.body.profile.rolling_windows.P1_VD?.last_8_sessions.length} sessions`,
);

/* ── Section 13 persistence: permanent per-attempt archive ────────────────── */

interface Dashboard {
  calibrated: boolean;
  heatmap: { days: unknown[]; current: number; longest: number };
  trends: unknown[];
  modules: unknown[];
  today: { sessions_completed: number; target_sessions: number; state: string };
  rank: { current: string; progress_pct: number };
  pcp_locked: boolean;
}

const dash = await call<Dashboard>('/dashboard', undefined, SESSION);
check('GET /dashboard', dash.status === 200 && dash.body.calibrated === true);
check('dashboard heatmap covers 26 weeks', dash.body.heatmap.days.length === 182, `${dash.body.heatmap.days.length} days`);
check('dashboard returns 5 trend series', dash.body.trends.length === 5, `${dash.body.trends.length} series`);
check(
  'dashboard today state is IN_PROGRESS after one of five sessions',
  dash.body.today.state === 'IN_PROGRESS' && dash.body.today.sessions_completed === 1,
  `${dash.body.today.state} ${dash.body.today.sessions_completed}/${dash.body.today.target_sessions}`,
);

const practice = await call<{ modules: unknown[] }>('/practice', undefined, SESSION);
check('GET /practice lists the 9 modules', practice.status === 200 && practice.body.modules.length === 9, `${practice.body.modules.length} modules`);

const onboarding = await call<{ calibrated: boolean; steps: unknown[] }>('/onboarding', undefined, SESSION);
check('GET /onboarding returns 5 plain-language steps', onboarding.status === 200 && onboarding.body.steps.length === 5);

/* The archive is append-only and must reflect the submitted attempts. */
const archiveExpect = attempts.length;

/* ── teacher observer view ────────────────────────────────────────────────── */

const admin = await post<{ user: UserDto }>('/auth/signin', {
  email: 'teacher@forge.local',
  password: 'teacher-demo-2024',
});
check('teacher can sign in', admin.status === 200 && admin.body.user?.role === 'admin', admin.body.user?.role);
const ADMIN = admin.cookie;

const list = await call<{ candidates: { id: string; display_name: string; rank_plain: string }[] }>(
  '/teacher/candidates',
  undefined,
  ADMIN,
);
check('GET /teacher/candidates', list.status === 200 && list.body.candidates.length > 0, `${list.body.candidates.length} candidates`);
check(
  'the new candidate appears in the teacher list',
  list.body.candidates.some((c) => c.id === CAND),
);
check(
  'teacher rows carry plain rank labels',
  list.body.candidates.every((c) => !/^RANK \d/.test(c.rank_plain ?? '')),
);

const detail = await call<{
  candidate: { id: string };
  pcp: Record<string, unknown> | null;
  structural_locks: unknown[];
  error_tag_frequency: unknown[];
  ape_history: unknown[];
  recent_sessions: unknown[];
  recommendation: string;
}>(
  `/teacher/candidates/${CAND}`,
  undefined,
  ADMIN,
);
check('GET /teacher/candidates/:id', detail.status === 200 && detail.body.candidate.id === CAND);
check('teacher detail exposes raw PCP', detail.body.pcp !== null && Object.keys(detail.body.pcp ?? {}).length > 0);
check('teacher detail counts error tags', (detail.body.error_tag_frequency ?? []).length > 0, `${detail.body.error_tag_frequency.length} tags`);
check('teacher detail returns a recommendation', typeof detail.body.recommendation === 'string' && detail.body.recommendation.length > 0);

const crossTeacher = await call<{ error: string }>('/teacher/candidates', undefined, OTHER);
check('a second candidate is still blocked from teacher routes (403)', crossTeacher.status === 403, `got ${crossTeacher.status}`);

/* ── sign out ─────────────────────────────────────────────────────────────── */

const out = await post<{ ok: boolean }>('/auth/signout', {}, SESSION);
check('POST /auth/signout', out.status === 200 && out.body.ok === true);

const afterOut = await call<{ user: UserDto | null }>('/auth/me', undefined, SESSION);
check('the session is dead after signout', afterOut.status === 200 && afterOut.body.user === null);

const afterOutDash = await call<{ error: string }>('/dashboard', undefined, SESSION);
check('the dead session cannot reach the dashboard (401)', afterOutDash.status === 401, `got ${afterOutDash.status}`);

/* The archive is append-only and never exposed to candidates, so it is
   verified through the teacher surface, which is the only reader. */
async function verifyArchive(): Promise<void> {
  const res = await call<{
    recent_attempts: {
      exercise_id: string;
      question_shown: string;
      is_correct: boolean;
      response_time_ms: number;
      error_tag: string | null;
      hidden_metrics_delta: string;
    }[];
  }>(`/teacher/candidates/${CAND}`, undefined, ADMIN);

  if (res.status !== 200) {
    check('archive is readable by a teacher', false, `got ${res.status}`);
    return;
  }
  const rows = res.body.recent_attempts ?? [];
  check('archive recorded every attempt', rows.length === archiveExpect, `${rows.length} of ${archiveExpect} rows`);
  check(
    'archive stored real prompt text, not the item id',
    rows.every((r) => r.question_shown !== r.exercise_id),
    `${rows.filter((r) => r.question_shown === r.exercise_id).length} fallbacks`,
  );
  check('archive keeps raw error tags', rows.some((r) => r.error_tag === 'PATTERN_MISMATCH'));
  check(
    'archive records hidden metric attribution',
    rows.every((r) => {
      try {
        return typeof JSON.parse(r.hidden_metrics_delta).basis === 'string';
      } catch {
        return false;
      }
    }),
  );

  const anonArchive = await call<{ error: string }>(`/teacher/candidates/${CAND}`);
  check('archive is not readable without auth (401)', anonArchive.status === 401, `got ${anonArchive.status}`);

  const candidateArchive = await call<{ error: string }>(`/teacher/candidates/${CAND}`, undefined, OTHER);
  check("a candidate cannot read anyone's archive (403)", candidateArchive.status === 403, `got ${candidateArchive.status}`);
}

await verifyArchive();

/**
 * Section 15: whole-surface sweep.
 *
 * /api/history and /api/stats shipped with latent 500s (a `created_at` column
 * that does not exist, and `AVG()` arriving as a string) that no suite caught,
 * because neither smoke nor e2e called those two routes. The route list is read
 * from the live Express table rather than hand-maintained, so a route added later
 * is swept automatically instead of quietly going untested.
 */
async function sweepEveryRoute(): Promise<void> {
  const { app } = await import('../src/app.js');

  const routes: { methods: string[]; path: string }[] = [];
  const walk = (stack: any[], prefix: string): void => {
    for (const layer of stack) {
      if (layer.route) {
        routes.push({
          methods: Object.keys(layer.route.methods ?? {}).filter((m) => m !== '_all'),
          path: prefix + layer.route.path,
        });
      } else if (layer.name === 'router' && layer.handle?.stack) {
        // Recover the mount prefix from the layer's regexp, e.g.
        // "^\\/api\\/teacher\\/?(?=\\/|$)" -> "/api/teacher". Getting this wrong
        // silently skips whole routers, so the shape is asserted below rather
        // than trusted.
        const src: string = layer.regexp?.source ?? '';
        const m = /^\^((?:\\\/[\w-]+)+)/.exec(src);
        const seg = m?.[1] ? m[1].replace(/\\\//g, '/') : '';
        walk(layer.handle.stack, prefix + seg);
      }
    }
  };
  walk((app as any)._router.stack, '');

  // Only GETs are swept: they are safe to call with no body and they cover every
  // read model, which is where the port's query bugs lived.
  const gets = [...new Set(routes.filter((r) => r.methods.includes('get')).map((r) => r.path))].sort();
  check('the route table exposes GET routes to sweep', gets.length > 20, `${gets.length} GET routes`);

  // A sweep that quietly misses a router is worse than no sweep: the two
  // previously-broken reads lived in routers, so assert the prefixes resolved.
  for (const needed of ['/api/history', '/api/stats', '/api/dashboard', '/api/auth/me', '/api/teacher/candidates/:id']) {
    check(`sweep covers ${needed}`, gets.includes(needed));
  }

  // Error text that means a query or a type assumption broke, even on a 200.
  const crash = /column \\"|does not exist|is not a function|undefined is not|null is not|Cannot read properties/i;

  for (const raw of gets) {
    // raw is now absolute, e.g. /api/history, so strip the /api that BASE carries.
    const path = raw.replace(':id', CAND).replace(/:module_id/g, 'P1_VD').replace(/^\/api/, '');
    for (const [role, cookie] of [['candidate', SESSION], ['admin', ADMIN]] as const) {
      const res = await fetch(`${BASE}${path}`, { headers: { cookie } });
      const text = await res.text();
      const broken = res.status >= 500 || (res.status === 200 && crash.test(text));
      if (broken) {
        check(`${role} GET ${path} responds cleanly`, false, `status ${res.status} ${text.slice(0, 120)}`);
      }
    }
  }
  check(`every GET route answers both roles without a 5xx (${gets.length} routes)`, true);

  // A missing candidate is a 404, not a server fault.
  const missing = await call<{ error: string }>('/teacher/candidates/does-not-exist', undefined, ADMIN);
  check('a missing candidate is 404, not 500', missing.status === 404, `got ${missing.status}`);
}

await sweepEveryRoute();

console.log('='.repeat(50));
console.log(failures === 0 ? `ALL ${checks} LIVE CHECKS PASSED` : `${failures} of ${checks} LIVE CHECKS FAILED`);
console.log('='.repeat(50));
process.exit(failures === 0 ? 0 : 1);

export {};
