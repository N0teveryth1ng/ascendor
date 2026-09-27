/**
 * Remove orphaned fixture candidate rows left behind by past test runs against
 * the production database.
 *
 * A candidate row whose id is not a real `users` id cannot log in, so it is
 * invisible to candidates but still shows up in teacher aggregates and keeps
 * polluting counts. Only ids carrying a reserved test prefix are touched, so
 * this can never delete a real account even if run carelessly.
 *
 * Run: node --import tsx scripts/purgeTestFixtures.ts [--apply]
 */
import { Pool } from '@neondatabase/serverless';

const PREFIXES = ['smoke-', 'streak-probe'] as const;
const apply = process.argv.includes('--apply');

/** Child-before-parent. Mirrors resetCandidates.ts; keep the two in step. */
const CANDIDATE_SCOPED: ReadonlyArray<readonly [string, string]> = [
  ['session_items', 'candidate_id'],
  ['session_attempts', 'candidate_id'],
  ['sessions', 'candidate_id'],
  ['exercise_attempts', 'user_id'],
  ['metric_history', 'candidate_id'],
  ['pending_remediation', 'candidate_id'],
  ['structural_locks', 'candidate_id'],
  ['error_counters', 'candidate_id'],
  ['rolling_windows', 'candidate_id'],
  ['daily_log', 'candidate_id'],
  ['rank_history', 'candidate_id'],
  ['streaks', 'candidate_id'],
  ['calibration_passes', 'candidate_id'],
  ['metrics', 'candidate_id'],
  ['metric_floors', 'candidate_id'],
  ['pcp', 'candidate_id'],
];

function url(): string {
  const v = process.env.DATABASE_URL ?? process.env.POSTGRES_URL ?? '';
  if (!v) throw new Error('DATABASE_URL or POSTGRES_URL must be set.');
  return v;
}

const pool = new Pool({ connectionString: url() });

try {
  // `users.id` is the authoritative list of real accounts; anything in
  // `candidates` that is not one of those is by definition not a login.
  // A fixture may still own engine rows if a past run created it without ever
  // signing in. Those rows hold a foreign key back to `candidates`, so they
  // have to go first or the candidate delete is refused.
  const orphans = await pool.query<{ candidate_id: string }>(
    `SELECT c.candidate_id FROM candidates c
      LEFT JOIN users u ON u.id = c.candidate_id
      WHERE u.id IS NULL
        AND (${PREFIXES.map((_, i) => `c.candidate_id LIKE $${i + 1}`).join(' OR ')})`,
    PREFIXES.map((p) => `${p}%`),
  );

  const ids = orphans.rows.map((r) => r.candidate_id);
  if (ids.length === 0) {
    console.log('[FORGE] no orphaned fixture candidates remain');
  } else {
    console.log(`[FORGE] orphaned fixture candidates: ${ids.join(', ')}`);
  }

  if (!apply) {
    console.log('[FORGE] dry run. Re-run with --apply to delete.');
    process.exit(0);
  }

  // Child-before-parent, in one transaction, so a half-cleared fixture is never
  // left behind and a real account is never in scope.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const [table, col] of CANDIDATE_SCOPED) {
      await client.query(`DELETE FROM "${table}" WHERE "${col}" = ANY($1::text[])`, [ids]);
    }
    for (const id of ids) {
      await client.query('DELETE FROM candidates WHERE candidate_id = $1', [id]);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  const after = await pool.query<{ candidate_id: string }>(
    `SELECT c.candidate_id FROM candidates c
      LEFT JOIN users u ON u.id = c.candidate_id
      WHERE u.id IS NULL`,
  );
  console.log(`[FORGE] removed ${ids.length}; remaining candidates: ${after.rows.map((r) => r.candidate_id).join(', ')}`);
} catch (err) {
  console.error(`[FORGE] ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
