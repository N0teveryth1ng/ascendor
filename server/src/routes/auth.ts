import { Router } from 'express';
import { clearSessionCookie, requireAuth, setSessionCookie } from '../middleware/auth.js';
import { sessionToken } from '../middleware/authCookies.js';
import {
  authenticate,
  createUser,
  destroySession,
  findUserByEmail,
  findUserById,
  issueSession,
  publicUser,
  userJsonPatch,
} from '../service/auth.js';
import { HttpError } from '../service/httpError.js';
import { signupAllowed } from '../service/seed.js';
import { asyncRoute } from './asyncRoute.js';

export const authRoutes = Router();

function slugify(name: string, email: string): string {
  const base = (name || email.split('@')[0] || 'learner')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return base || 'learner';
}

async function uniqueId(base: string): Promise<string> {
  let id = base;
  let n = 2;
  while (await findUserById(id)) id = `${base}-${n++}`;
  return id;
}

authRoutes.get(
  '/me',
  asyncRoute(async (req, res) => {
    res.json({ user: req.user ? await publicUser(req.user) : null, signup_allowed: signupAllowed() });
  }),
);

authRoutes.post(
  '/signup',
  asyncRoute(async (req, res) => {
    // Fixed-account deployments have exactly two candidates by design, so
    // third-party registration is refused before any work is done.
    if (!signupAllowed()) {
      throw new HttpError(403, 'Registration is closed. Sign in with your assigned account.');
    }

    const email = String(req.body?.email ?? '').trim();
    const password = String(req.body?.password ?? '');
    const display_name = String(req.body?.display_name ?? '').trim();

    if (await findUserByEmail(email)) {
      throw new HttpError(409, 'An account with that email already exists. Try signing in instead.');
    }

    const base = slugify(display_name, email);
    const user = await createUser({
      id: await uniqueId(base),
      email,
      password,
      display_name,
      timezone: String(req.body?.timezone ?? 'UTC'),
    });

    const { token, expiresAt } = await issueSession(user.id, req.headers['user-agent']);
    setSessionCookie(res, token, expiresAt);
    res.status(201).json({ user: await publicUser(user) });
  }),
);

authRoutes.post(
  '/signin',
  asyncRoute(async (req, res) => {
    const user = await authenticate(String(req.body?.email ?? ''), String(req.body?.password ?? ''));
    const { token, expiresAt } = await issueSession(user.id, req.headers['user-agent']);
    setSessionCookie(res, token, expiresAt);
    res.json({ user: await publicUser(user) });
  }),
);

authRoutes.post(
  '/signout',
  asyncRoute(async (req, res) => {
    await destroySession(sessionToken(req));
    clearSessionCookie(res);
    res.json({ ok: true });
  }),
);

authRoutes.patch(
  '/me',
  requireAuth,
  asyncRoute(async (req, res) => {
    const updated = await userJsonPatch(req.user!.id, {
      display_name: req.body?.display_name,
      avatar: req.body?.avatar,
      timezone: req.body?.timezone,
    });
    res.json({ user: await publicUser(updated) });
  }),
);
