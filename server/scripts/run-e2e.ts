/**
 * Self-contained entry point for the live HTTP suite.
 *
 * `scripts/e2e.ts` is deliberately just an HTTP client: it asserts against a
 * server that is already listening, which made `npm run e2e` fail in a way that
 * looked like a product defect (ECONNREFUSED on the default port) when the only
 * problem was that nobody had started the server. This wrapper boots the app in
 * the same process, points the suite at it, and lets the suite's own
 * process.exit() tear everything down.
 *
 * The server is started from source with tsx rather than from `dist/` on
 * purpose, so the suite can never pass against a stale build.
 *
 * Run: npm run e2e --workspace server
 */
import { createServer } from 'node:http';

const PORT = Number(process.env.E2E_PORT ?? 5174);
const HOST = '127.0.0.1';
const BASE = `http://${HOST}:${PORT}/api`;

// The suite signs in as the seeded observer to exercise the teacher read models,
// and signs up its own candidate, so demo seeding is required and fixed-account
// mode must be off or signup would be refused.
process.env.SEED_DEMO = '1';
process.env.FIXED_ACCOUNTS = '0';
process.env.FORGE_E2E_BASE = BASE;

const { app, prepare } = await import('../src/app.js');

// Opening the listener only after prepare() means the suite's first request
// cannot race an unmigrated database.
await prepare();

const server = createServer(app);
await new Promise<void>((resolve, reject) => {
  server.once('error', reject);
  server.listen(PORT, HOST, () => resolve());
});

// Warm the first request so the readiness probe is not mistaken for a hang: the
// suite measures a remote database, where one round-trip can be hundreds of ms.
const deadline = Date.now() + 60_000;
for (;;) {
  try {
    const res = await fetch(`${BASE}/meta`, { signal: AbortSignal.timeout(10_000) });
    if (res.ok) break;
  } catch {
    // keep polling until the deadline
  }
  if (Date.now() > deadline) {
    console.error(`[e2e] server never became ready on ${BASE}/meta`);
    process.exit(1);
  }
}

await import('./e2e.js');
