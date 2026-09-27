/**
 * Post-reset verification against the live database.
 *
 * `sessions=[]` from the API does not prove a clean reset: rolling_windows,
 * error_counters, structural_locks, streaks and rank_history can all survive and
 * still feed the first real session's APE and Glicko-2 numbers. So this queries
 * every table directly, per account, and reports what it finds.
 *
 * Read-only. Run: node --import tsx scripts/verifyReset.ts
 */
import { Pool } from '@neondatabase/serverless';

const ACCOUNTS = ['billi', 'anik'] as const;

/** Every engine table, with the column that links a row back to a candidate. */
const TABLES: ReadonlyArray<readonly [string, string]> = [
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
  ['auth_sessions', 'user_id'],
];

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
let failures = 0;

try {
  for (const id of ACCOUNTS) {
    console.log(`\n=== ${id} ===`);

    let total = 0;
    for (const [table, col] of TABLES) {
      const r = await pool.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM "${table}" WHERE "${col}" = $1`,
        [id],
      );
      const n = r.rows[0]?.n ?? 0;
      if (table === 'auth_sessions') {
        // A live login cookie is expected here and is not pollution.
        console.log(`  ${table.padEnd(20)} ${n}  (live session cookies, expected non-zero)`);
        continue;
      }
      total += n;
      if (n > 0) {
        failures += 1;
        console.log(`  ${table.padEnd(20)} ${n}  <-- NOT EMPTY`);
      }
    }
    console.log(`  ${'engine rows'.padEnd(20)} ${total}${total === 0 ? '  clean' : '  <-- DIRTY'}`);

    // Streak and rank are derived, so read the derived values rather than
    // trusting that an empty table implies an empty value.
    const s = await pool.query<{ current: number; best: number; last_date: string | null }>(
      'SELECT current, best, last_date FROM streaks WHERE candidate_id = $1',
      [id],
    );
    console.log(
      `  streak row: ${s.rows.length === 0 ? 'absent (streak = 0)' : `current=${s.rows[0]!.current} best=${s.rows[0]!.best} last_date=${s.rows[0]!.last_date}`}`,
    );

    const r = await pool.query<{ rank: string; at: string }>(
      'SELECT rank, at FROM rank_history WHERE candidate_id = $1 ORDER BY at DESC LIMIT 1',
      [id],
    );
    console.log(`  last rank_history: ${r.rows.length === 0 ? 'absent (starting rank applies)' : `${r.rows[0]!.rank} at ${r.rows[0]!.at}`}`);

    const p = await pool.query('SELECT * FROM pcp WHERE candidate_id = $1', [id]);
    console.log(`  pcp: ${p.rows.length === 0 ? 'absent (calibration required)' : 'PRESENT <-- DIRTY'}`);

    const u = await pool.query<{ id: string; role: string }>(
      'SELECT id, role FROM users WHERE id = $1',
      [id],
    );
    console.log(`  login row: ${u.rows.length === 1 ? `intact (${u.rows[0]!.role})` : 'MISSING <-- LOGIN BROKEN'}`);
    if (u.rows.length !== 1) failures += 1;
  }

  console.log(
    failures === 0
      ? '\nOK — both accounts empty in every engine table, both logins intact.'
      : `\nFAILED — ${failures} problem(s) above.`,
  );
} catch (err) {
  console.error(`[FORGE] ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
