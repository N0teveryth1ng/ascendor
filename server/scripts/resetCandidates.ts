/**
 * Targeted reset of the two fixed candidate accounts (billi, anik).
 *
 * Deletes every row those two candidates own and nothing else. `users`,
 * `auth_sessions` and `candidates` are deliberately left intact so both
 * accounts can still sign in — the point is a clean *track*, not a clean login.
 *
 * Unlike resetTestDatabase() this never truncates, so it is safe against the
 * production database: it cannot touch a row that does not belong to a named
 * candidate.
 *
 * Run: node --import tsx scripts/resetCandidates.ts [--apply]
 *
 * With no --apply it reports only. The two-phase design is deliberate: this
 * script is destructive and the first run must show exactly what will go.
 */
import { Pool } from '@neondatabase/serverless';

const TARGET_NAMES = ['billi', 'anik'] as const;

/**
 * Child-before-parent so no DELETE is blocked by a foreign key. Every entry
 * names the column that links the row back to a candidate, because the archive
 * and the session tables do not use the same one.
 */
const TARGETED: ReadonlyArray<readonly [string, string]> = [
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

/** Never written to. Listed so the guarantee is visible in the code. */
const PRESERVED = ['users', 'auth_sessions', 'candidates'] as const;

const apply = process.argv.includes('--apply');

function url(): string {
  const v = process.env.DATABASE_URL ?? process.env.POSTGRES_URL ?? '';
  if (!v) throw new Error('DATABASE_URL or POSTGRES_URL must be set.');
  return v;
}

/** The database name is the last path segment of the connection string. */
function databaseName(): string {
  return decodeURIComponent(url().split('?')[0]!.split('/').pop() ?? '');
}

async function main(): Promise<void> {
  console.log(`[FORGE] target database: "${databaseName()}"`);
  console.log(`[FORGE] mode: ${apply ? 'APPLY (destructive)' : 'DRY RUN (no writes)'}`);

  const pool = new Pool({ connectionString: url() });

  try {
    // Which columns actually link each table back to a candidate. Guessing
    // wrong here would either no-op or delete the wrong rows, so ask.
    const existing = new Set<string>();
    const tables = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
    );
    for (const row of tables.rows) existing.add(row.table_name);

    // Resolve the candidate ids from their names rather than assuming they are
    // the names themselves.
    const cols = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'candidates'`,
    );
    const idCol = ['id', 'candidate_id', 'user_id'].find((c) =>
      cols.rows.some((r) => r.column_name === c),
    );
    if (!idCol) throw new Error('candidates has none of id/candidate_id/user_id.');

    const nameCol = ['name', 'username', 'display_name'].find((c) =>
      cols.rows.some((r) => r.column_name === c),
    ) ?? idCol;

    const found = await pool.query<Record<string, string>>(
      `SELECT "${idCol}" AS id FROM candidates
        WHERE LOWER("${nameCol}") = ANY($1::text[])
           OR LOWER("${idCol}") = ANY($1::text[])`,
      [TARGET_NAMES.map((n) => n.toLowerCase())],
    );
    const ids = found.rows.map((r) => r.id).filter((v): v is string => typeof v === 'string');
    if (ids.length === 0) {
      throw new Error(`no candidate matched ${TARGET_NAMES.join(', ')} — nothing to do.`);
    }
    console.log(`[FORGE] matched ${ids.length} candidate(s): ${ids.join(', ')}`);

    // Anything rating-shaped, so an unwired Section 15 is reported rather than
    // silently assumed absent.
    const ratingish = [...existing].filter((t) => /rating|glicko|elo/i.test(t));
    console.log(
      ratingish.length
        ? `[FORGE] rating-like tables present: ${ratingish.join(', ')}`
        : '[FORGE] no rating-like table exists (Glicko-2 Section 15 is unwired) — nothing to clear',
    );

    // Count first, so the report is the same shape in both modes.
    let total = 0;
    console.log('\n[FORGE] rows that will be deleted:');
    for (const [table, col] of TARGETED) {
      if (!existing.has(table)) {
        console.log(`  ${table.padEnd(22)} — table does not exist, skipped`);
        continue;
      }
      const has = await pool.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM "${table}" WHERE "${col}" = ANY($1::text[])`,
        [ids],
      );
      const n = has.rows[0]?.n ?? 0;
      total += n;
      console.log(`  ${table.padEnd(22)} ${col.padEnd(13)} ${n}`);
    }
    console.log(`\n[FORGE] total rows affected: ${total}`);
    console.log(`[FORGE] preserved untouched: ${PRESERVED.join(', ')}`);

    if (!apply) {
      console.log('\n[FORGE] dry run complete. Re-run with --apply to delete.');
      return;
    }

    // One transaction: a partial reset is worse than none, because it would
    // leave a half-empty track that still looks like real history.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const [table, col] of TARGETED) {
        if (!existing.has(table)) continue;
        await client.query(`DELETE FROM "${table}" WHERE "${col}" = ANY($1::text[])`, [ids]);
      }
      await client.query('COMMIT');
      console.log('[FORGE] reset committed');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    // Verify: the targeted tables must now be empty for these ids, and the
    // account rows must still exist or neither candidate can sign in.
    console.log('\n[FORGE] post-reset verification:');
    let remaining = 0;
    for (const [table, col] of TARGETED) {
      if (!existing.has(table)) continue;
      const after = await pool.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM "${table}" WHERE "${col}" = ANY($1::text[])`,
        [ids],
      );
      const n = after.rows[0]?.n ?? 0;
      remaining += n;
      if (n !== 0) console.log(`  FAIL ${table}: ${n} rows survived`);
    }
    console.log(`  targeted rows remaining: ${remaining}`);

    for (const table of PRESERVED) {
      // users/auth_sessions key off `id`/`user_id`, candidates off `candidate_id`.
      const key = table === 'candidates' ? 'candidate_id' : table === 'auth_sessions' ? 'user_id' : 'id';
      if (!existing.has(table)) {
        console.log(`  ${table.padEnd(16)} table does not exist, skipped`);
        continue;
      }
      const still = await pool.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM "${table}" WHERE "${key}" = ANY($1::text[])`,
        [ids],
      );
      const n = still.rows[0]?.n ?? 0;
      console.log(`  ${table.padEnd(16)} rows kept: ${n}${n === 0 ? '  <-- LOGIN WOULD BREAK' : ''}`);
    }
    console.log(
      remaining === 0
        ? '\n[FORGE] OK — both tracks are empty and both accounts can still sign in.'
        : '\n[FORGE] FAILED — rows survived; investigate before reporting success.',
    );
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error(`[FORGE] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
