import type { NextFunction, Request, Response } from 'express';
import { SESSION_COOKIE, sessionToken } from './authCookies.js';
import { resolveSession, type Role, type UserRow } from '../service/auth.js';
import { HttpError } from '../service/httpError.js';

export { readCookie, sessionToken, SESSION_COOKIE } from './authCookies.js';

declare global {
  namespace Express {
    interface Request {
      user?: UserRow;
    }
  }
}

/** Attaches req.user when a valid session cookie is present. Never rejects. */
export function attachUser(req: Request, _res: Response, next: NextFunction): void {
  // A session lookup is a database round trip now, so resolution is deferred
  // to the microtask queue and the request is parked rather than blocking the
  // event loop. `next` is called from the continuation, not synchronously.
  void resolveSession(sessionToken(req)).then(
    (user) => {
      if (user) req.user = user;
      next();
    },
    () => next(),
  );
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) throw new HttpError(401, 'Please sign in to continue.');
  next();
}

export function requireRole(role: Role) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) throw new HttpError(401, 'Please sign in to continue.');
    if (req.user.role !== role) throw new HttpError(403, 'You do not have access to this area.');
    next();
  };
}

/**
 * Candidate routes may only ever touch the signed-in user's own track. The
 * engine is unchanged; this is purely an ownership check on the way in, so
 * Section 5.1's independent-track requirement is enforced by auth rather than
 * by trusting the id in the URL.
 */
export function requireSelf(req: Request, _res: Response, next: NextFunction): void {
  const user = req.user;
  if (!user) throw new HttpError(401, 'Please sign in to continue.');
  if (user.role !== 'candidate') {
    throw new HttpError(403, 'Teacher accounts observe candidates, they do not practise.');
  }
  if (req.params.id !== user.id) {
    throw new HttpError(403, 'You can only view your own progress.');
  }
  next();
}

export function setSessionCookie(res: Response, token: string, expiresAt: string): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    path: '/',
    expires: new Date(expiresAt),
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'lax', path: '/' });
}
