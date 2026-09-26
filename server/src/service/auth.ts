import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { getDb, plain, plainAll, parseJson } from '../db/index.js';
import { SESSION_TTL_MS } from '../middleware/authCookies.js';
import { HttpError } from './httpError.js';

export type Role = 'candidate' | 'admin';

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  avatar: string | null;
  role: Role;
  timezone: string;
  created_at: string;
}

export interface SessionRow {
  token_hash: string;
  user_id: string;
  created_at: string;
  expires_at: string;
  user_agent: string | null;
}

export { SESSION_TTL_MS } from '../middleware/authCookies.js';


const SCRYPT_N = 16384;
const SCRYPT_KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, SCRYPT_KEYLEN, { N: SCRYPT_N });
  return `scrypt$${SCRYPT_N}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, nRaw, saltRaw, keyRaw] = stored.split('$');
  if (scheme !== 'scrypt' || !nRaw || !saltRaw || !keyRaw) return false;
  const salt = Buffer.from(saltRaw, 'base64');
  const expected = Buffer.from(keyRaw, 'base64');
  const actual = scryptSync(password, salt, expected.length, { N: Number(nRaw) });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface CreateUserInput {
  id: string;
  email: string;
  password: string;
  display_name: string;
  role?: Role;
  timezone?: string;
  avatar?: string | null;
}

export function createUser(input: CreateUserInput): UserRow {
  const db = getDb();
  const email = input.email.trim().toLowerCase();
  if (!email.includes('@')) throw new HttpError(400, 'Enter a valid email address.');
  if (input.password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters.');

  const existing = db.prepare('SELECT id FROM users WHERE lower(email) = ?').get(email);
  if (existing) throw new HttpError(409, 'An account with that email already exists.');

  const now = new Date().toISOString();
  const row: UserRow = {
    id: input.id,
    email,
    password_hash: hashPassword(input.password),
    display_name: input.display_name.trim() || email.split('@')[0]!,
    avatar: input.avatar ?? null,
    role: input.role ?? 'candidate',
    timezone: input.timezone ?? 'UTC',
    created_at: now,
  };

  db.prepare(
    `INSERT INTO users (id, email, password_hash, display_name, avatar, role, timezone, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(row.id, row.email, row.password_hash, row.display_name, row.avatar, row.role, row.timezone, row.created_at);

  if (row.role === 'candidate') {
    db.prepare('INSERT OR IGNORE INTO candidates (candidate_id, display_name, created_at) VALUES (?, ?, ?)').run(
      row.id,
      row.display_name,
      now,
    );
  }
  return row;
}

export function findUserByEmail(email: string): UserRow | null {
  const db = getDb();
  const r = db.prepare('SELECT * FROM users WHERE lower(email) = ?').get(email.trim().toLowerCase());
  return plain<UserRow>(r);
}

export function findUserById(id: string): UserRow | null {
  const db = getDb();
  return plain<UserRow>(db.prepare('SELECT * FROM users WHERE id = ?').get(id));
}

export function listUsers(): UserRow[] {
  const db = getDb();
  return plainAll<UserRow>(db.prepare('SELECT * FROM users ORDER BY created_at').all() as unknown[]);
}

export function authenticate(email: string, password: string): UserRow {
  const user = findUserByEmail(email);
  if (!user || !verifyPassword(password, user.password_hash)) {
    throw new HttpError(401, 'That email and password combination did not work.');
  }
  return user;
}

export function issueSession(userId: string, userAgent?: string | null): { token: string; expiresAt: string } {
  const db = getDb();
  const token = randomBytes(32).toString('base64url');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();
  db.prepare(
    'INSERT INTO auth_sessions (token_hash, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)',
  ).run(hashToken(token), userId, now.toISOString(), expiresAt, userAgent ?? null);
  return { token, expiresAt };
}

export function resolveSession(token: string | undefined): UserRow | null {
  if (!token) return null;
  const db = getDb();
  const row = plain<SessionRow>(db.prepare('SELECT * FROM auth_sessions WHERE token_hash = ?').get(hashToken(token)));
  if (!row) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(row.token_hash);
    return null;
  }
  return findUserById(row.user_id);
}

export function destroySession(token: string | undefined): void {
  if (!token) return;
  getDb().prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(hashToken(token));
}

export function purgeExpiredSessions(): void {
  getDb().prepare('DELETE FROM auth_sessions WHERE expires_at <= ?').run(new Date().toISOString());
}

export function publicUser(u: UserRow): {
  id: string;
  email: string;
  display_name: string;
  avatar: string | null;
  role: Role;
  timezone: string;
  calibrated: boolean;
} {
  const db = getDb();
  const pcpRow = db.prepare('SELECT locked FROM pcp WHERE candidate_id = ?').get(u.id) as { locked?: number } | undefined;
  return {
    id: u.id,
    email: u.email,
    display_name: u.display_name,
    avatar: u.avatar,
    role: u.role,
    timezone: u.timezone,
    calibrated: u.role === 'candidate' ? pcpRow?.locked === 1 : false,
  };
}

export function setPassword(userId: string, password: string): void {
  if (password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters.');
  getDb().prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), userId);
}

export function userJsonPatch(userId: string, patch: { display_name?: string; avatar?: string | null; timezone?: string }): UserRow {
  const current = findUserById(userId);
  if (!current) throw new HttpError(404, 'Account not found.');
  const display_name = patch.display_name?.trim() || current.display_name;
  const avatar = patch.avatar === undefined ? current.avatar : patch.avatar;
  const timezone = patch.timezone ?? current.timezone;
  getDb()
    .prepare('UPDATE users SET display_name = ?, avatar = ?, timezone = ? WHERE id = ?')
    .run(display_name, avatar, timezone, userId);
  getDb()
    .prepare('UPDATE candidates SET display_name = ? WHERE candidate_id = ?')
    .run(display_name, userId);
  return findUserById(userId)!;
}

export function jsonOf<T>(raw: unknown, fallback: T): T {
  return parseJson<T>(raw, fallback);
}
