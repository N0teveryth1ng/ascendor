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

export const authRoutes = Router();

function slugify(name: string, email: string): string {
  const base = (name || email.split('@')[0] || 'learner')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return base || 'learner';
}

function uniqueId(base: string): string {
  let id = base;
  let n = 2;
  while (findUserById(id)) id = `${base}-${n++}`;
  return id;
}

authRoutes.get('/me', (req, res) => {
  if (!req.user) {
    res.json({ user: null });
    return;
  }
  res.json({ user: publicUser(req.user) });
});

authRoutes.post('/signup', (req, res) => {
  const email = String(req.body?.email ?? '').trim();
  const password = String(req.body?.password ?? '');
  const display_name = String(req.body?.display_name ?? '').trim();

  if (findUserByEmail(email)) throw new HttpError(409, 'An account with that email already exists. Try signing in instead.');

  const base = slugify(display_name, email);
  const user = createUser({
    id: uniqueId(base),
    email,
    password,
    display_name,
    timezone: String(req.body?.timezone ?? 'UTC'),
  });

  const { token, expiresAt } = issueSession(user.id, req.headers['user-agent']);
  setSessionCookie(res, token, expiresAt);
  res.status(201).json({ user: publicUser(user) });
});

authRoutes.post('/signin', (req, res) => {
  const user = authenticate(String(req.body?.email ?? ''), String(req.body?.password ?? ''));
  const { token, expiresAt } = issueSession(user.id, req.headers['user-agent']);
  setSessionCookie(res, token, expiresAt);
  res.json({ user: publicUser(user) });
});

authRoutes.post('/signout', (req, res) => {
  destroySession(sessionToken(req));
  clearSessionCookie(res);
  res.json({ ok: true });
});

authRoutes.patch('/me', requireAuth, (req, res) => {
  const updated = userJsonPatch(req.user!.id, {
    display_name: req.body?.display_name,
    avatar: req.body?.avatar,
    timezone: req.body?.timezone,
  });
  res.json({ user: publicUser(updated) });
});
