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

export async function createUser(input: CreateUserInput): Promise<UserRow> {
  const db = getDb();
  const email = input.email.trim().toLowerCase();
  if (!email.includes('@')) throw new HttpError(400, 'Enter a valid email address.');
  if (input.password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters.');

  const existing = await db.prepare('SELECT id FROM users WHERE lower(email) = $1').get(email);
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

  await db
    .prepare(
      `INSERT INTO users (id, email, password_hash, display_name, avatar, role, timezone, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(row.id, row.email, row.password_hash, row.display_name, row.avatar, row.role, row.timezone, row.created_at);

  if (row.role === 'candidate') {
    await db
      .prepare(
        `INSERT INTO candidates (candidate_id, display_name, created_at) VALUES (?, ?, ?)
         ON CONFLICT (candidate_id) DO UPDATE SET display_name = EXCLUDED.display_name`,
      )
      .run(row.id, row.display_name, now);
  }
  return row;
}

export async function findUserByEmail(email: string): Promise<UserRow | null> {
  const db = getDb();
  const r = await db.prepare('SELECT * FROM users WHERE lower(email) = $1').get(email.trim().toLowerCase());
  return plain<UserRow>(r);
}

export async function findUserById(id: string): Promise<UserRow | null> {
  const db = getDb();
  return plain<UserRow>(await db.prepare('SELECT * FROM users WHERE id = $1').get(id));
}

interface SeedAccountInput {
  id: string;
  email: string;
  password: string;
  display_name: string;
  role: 'candidate' | 'admin';
}

/**
 * Inserts a seeded account, or updates it in place so the stored credentials
 * match the environment on every cold start.
 *
 * This is deliberately an upsert and not "create if absent". With fixed
 * accounts, the environment is the source of truth: if the row already exists
 * with an older password, email, or role, a create-once seeder leaves the stale
 * values in place and every signin fails with a 401 that reads like a wrong
 * password rather than a seeding bug. That is exactly what happens when a
 * database was seeded earlier as a demo and is later used in fixed-account mode.
 *
 * Returns true when a row was written.
 */
export async function convergeSeededAccount(input: SeedAccountInput): Promise<boolean> {
  const db = getDb();
  const email = input.email.trim().toLowerCase();
  if (!email.includes('@')) throw new HttpError(400, 'Enter a valid email address.');
  if (input.password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters.');

  // A different id may already hold this email. Overwriting would hand the
  // account to the wrong owner, so refuse instead and let the log say so.
  const holder = await db.prepare('SELECT id FROM users WHERE lower(email) = $1').get(email);
  if (holder && holder.id !== input.id) {
    throw new HttpError(409, `email ${email} is already used by account ${holder.id}`);
  }

  const existing = await findUserById(input.id);
  const now = new Date().toISOString();

  if (!existing) {
    await db
      .prepare(
        `INSERT INTO users (id, email, password_hash, display_name, avatar, role, timezone, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        email,
        hashPassword(input.password),
        input.display_name,
        null,
        input.role,
        'UTC',
        now,
      );
  } else {
    const sameCredentials =
      existing.email === email &&
      existing.display_name === input.display_name &&
      existing.role === input.role &&
      verifyPassword(input.password, existing.password_hash);
    if (sameCredentials) return false;

    // Sessions belong to the credential that issued them, so a password change
    // has to invalidate them or a rotated password would still be usable by a
    // session cookie minted under the old one.
    await db
      .prepare(
        `UPDATE users SET email = $1, password_hash = $2, display_name = $3, role = $4 WHERE id = $5`,
      )
      .run(email, hashPassword(input.password), input.display_name, input.role, input.id);
    await db.prepare('DELETE FROM auth_sessions WHERE user_id = $1').run(input.id);
  }

  if (input.role === 'candidate') {
    await db
      .prepare(
        `INSERT INTO candidates (candidate_id, display_name, created_at) VALUES (?, ?, ?)
         ON CONFLICT (candidate_id) DO UPDATE SET display_name = EXCLUDED.display_name`,
      )
      .run(input.id, input.display_name, now);
  }
  return true;
}

export async function listUsers(): Promise<UserRow[]> {
  const db = getDb();
  return plainAll<UserRow>((await db.prepare('SELECT * FROM users ORDER BY created_at').all()) as unknown[]);
}

export async function authenticate(email: string, password: string): Promise<UserRow> {
  const user = await findUserByEmail(email);
  if (!user || !verifyPassword(password, user.password_hash)) {
    throw new HttpError(401, 'That email and password combination did not work.');
  }
  return user;
}

export async function issueSession(userId: string, userAgent?: string | null): Promise<{ token: string; expiresAt: string }> {
  const db = getDb();
  const token = randomBytes(32).toString('base64url');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();
  await db
    .prepare(
      'INSERT INTO auth_sessions (token_hash, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)',
    )
    .run(hashToken(token), userId, now.toISOString(), expiresAt, userAgent ?? null);
  return { token, expiresAt };
}

export async function resolveSession(token: string | undefined): Promise<UserRow | null> {
  if (!token) return null;
  const db = getDb();
  const row = plain<SessionRow>(
    await db.prepare('SELECT * FROM auth_sessions WHERE token_hash = $1').get(hashToken(token)),
  );
  if (!row) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    await db.prepare('DELETE FROM auth_sessions WHERE token_hash = $1').run(row.token_hash);
    return null;
  }
  return findUserById(row.user_id);
}

export async function destroySession(token: string | undefined): Promise<void> {
  if (!token) return;
  const db = getDb();
  await db.prepare('DELETE FROM auth_sessions WHERE token_hash = $1').run(hashToken(token));
}

export async function purgeExpiredSessions(): Promise<void> {
  const db = getDb();
  await db.prepare('DELETE FROM auth_sessions WHERE expires_at <= $1').run(new Date().toISOString());
}

export async function publicUser(u: UserRow): Promise<{
  id: string;
  email: string;
  display_name: string;
  avatar: string | null;
  role: Role;
  timezone: string;
  calibrated: boolean;
}> {
  const db = getDb();
  const pcpRow = (await db.prepare('SELECT locked FROM pcp WHERE candidate_id = $1').get(u.id)) as
    | { locked?: number }
    | undefined;
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

export async function setPassword(userId: string, password: string): Promise<void> {
  if (password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters.');
  const db = getDb();
  await db.prepare('UPDATE users SET password_hash = $1 WHERE id = $2').run(hashPassword(password), userId);
}

export async function userJsonPatch(
  userId: string,
  patch: { display_name?: string; avatar?: string | null; timezone?: string },
): Promise<UserRow> {
  const current = await findUserById(userId);
  if (!current) throw new HttpError(404, 'Account not found.');
  const display_name = patch.display_name?.trim() || current.display_name;
  const avatar = patch.avatar === undefined ? current.avatar : patch.avatar;
  const timezone = patch.timezone ?? current.timezone;
  const db = getDb();
  await db
    .prepare('UPDATE users SET display_name = $1, avatar = $2, timezone = $3 WHERE id = $4')
    .run(display_name, avatar, timezone, userId);
  await db
    .prepare('UPDATE candidates SET display_name = $1 WHERE candidate_id = $2')
    .run(display_name, userId);
  return (await findUserById(userId))!;
}

export function jsonOf<T>(raw: unknown, fallback: T): T {
  return parseJson<T>(raw, fallback);
}
