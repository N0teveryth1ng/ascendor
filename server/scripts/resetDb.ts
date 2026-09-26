/**
 * Full database wipe, for a dedicated throwaway database only.
 *
 * Run: npm run db:reset --workspace server
 *
 * Refuses to run unless the database name contains test/tests/smoke/ci, so a
 * mistyped DATABASE_URL cannot destroy real candidate tracks. For the smoke
 * suite's own cleanup — which is safe on any database — see resetSmokeFixtures.
 */
import { resetTestDatabase } from './testDb.js';

try {
  await resetTestDatabase();
} catch (err) {
  console.error(`[FORGE] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
