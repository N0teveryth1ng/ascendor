/**
 * Test-only database reset.
 *
 * The suite used to delete a local SQLite file to guarantee a clean slate. There
 * is no equivalent on a hosted Postgres, and dropping a shared database would
 * destroy real candidate tracks, so there are two levels here:
 *
 *  - `resetSmokeFixtures()` deletes only the rows belonging to the candidate ids
 *    the suite itself creates. It is safe on ANY database, so the suite can run
 *    against a development database without touching real tracks.
 *  - `resetTestDatabase()` TRUNCATEs everything and refuses to run unless the
 *    database name says it is a throwaway. For a clean slate on a scratch DB.
 */
import { getPool } from '../src/db/index.js';

/** Tables are truncated together so foreign keys never block the reset. */
const TABLES = [
  'session_items',
  'session_attempts',
  'sessions',
  'exercise_attempts',
  'metric_history',
  'daily_log',
  'streaks',
  'error_counters',
  'structural_locks',
  'rolling_windows',
  'pending_remediation',
  'rank_history',
  'calibration_passes',
  'metric_floors',
  'metrics',
  'pcp',
  'auth_sessions',
  'users',
  'candidates',
];

/** Child-before-parent, so no DELETE is blocked by a foreign key. */
const CANDIDATE_SCOPED = [
  'session_items',
  'session_attempts',
  'sessions',
  'metric_history',
  'daily_log',
  'streaks',
  'error_counters',
  'structural_locks',
  'rolling_windows',
  'pending_remediation',
  'rank_history',
  'calibration_passes',
  'metric_floors',
  'metrics',
  'pcp',
] as const;

function databaseName(): string {
  const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL ?? '';
  // The database name is the last path segment of the connection string.
  return decodeURIComponent(url.split('?')[0]!.split('/').pop() ?? '');
}

/**
 * Removes every row owned by the given candidates, and nothing else. Order is
 * child-first so foreign keys never block a delete, and `auth_sessions` /
 * `users` go with the candidate because a user id IS its candidate id.
 *
 * This is the reset the smoke suite uses. It refuses any id that is not
 * namespaced, which is what makes it safe to point at a real database: without
 * that check a suite that named `billi` or `anik` would silently delete a real
 * candidate's entire track while appearing to clean up after itself.
 */
const FIXTURE_PREFIX = 'smoke-';

export async function resetSmokeFixtures(candidateIds: readonly string[]): Promise<void> {
  if (candidateIds.length === 0) return;
  const ids = [...candidateIds];

  const unqualified = ids.filter((id) => !id.startsWith(FIXTURE_PREFIX));
  if (unqualified.length > 0) {
    throw new Error(
      `refusing to delete un-namespaced candidate id(s): ${unqualified.join(', ')}. ` +
        `Every id passed to resetSmokeFixtures() must start with "${FIXTURE_PREFIX}" so that ` +
        'a test run can never destroy a real account. Rename the fixture or use ' +
        'resetTestDatabase() against a throwaway database.',
    );
  }

  const pool = getPool();

  for (const table of CANDIDATE_SCOPED) {
    await pool.query(`DELETE FROM ${table} WHERE candidate_id = ANY($1::text[])`, [ids]);
  }
  // The append-only archive and session cookies key off the user/candidate id.
  await pool.query('DELETE FROM exercise_attempts WHERE user_id = ANY($1::text[])', [ids]);
  await pool.query('DELETE FROM auth_sessions WHERE user_id = ANY($1::text[])', [ids]);
  await pool.query('DELETE FROM users WHERE id = ANY($1::text[])', [ids]);
  await pool.query('DELETE FROM candidates WHERE candidate_id = ANY($1::text[])', [ids]);

  console.log(`[FORGE] cleared smoke fixtures for: ${ids.join(', ')} (in "${databaseName()}")`);
}

/**
 * Full wipe. Refuses to run unless the target database name says it is a
 * throwaway, so a mistyped DATABASE_URL cannot destroy real candidate tracks.
 */
export async function resetTestDatabase(): Promise<void> {
  const name = databaseName();
  if (!/(^|[-_])(test|tests|smoke|ci)([-_]|$)/i.test(name)) {
    throw new Error(
      `refusing to truncate database "${name || 'unknown'}": a full reset only runs against a ` +
        'database whose name contains test/tests/smoke/ci. Point DATABASE_URL at a dedicated ' +
        'throwaway Neon database or branch, or use resetSmokeFixtures(), which is safe anywhere.',
    );
  }
  await getPool().query(`TRUNCATE TABLE ${TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`);
  console.log(`[FORGE] reset test database "${name}"`);
}
