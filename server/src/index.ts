import { app, prepare } from './app.js';

const PORT = Number(process.env.PORT ?? 5174);
const HOST = process.env.HOST ?? '127.0.0.1';

/**
 * Long-running process entry point (local dev, `npm start`, container hosts).
 *
 * The schema is applied and any fixtures are written before the listener opens,
 * so the first request cannot race an unmigrated database. For a serverless
 * host, see `api/index.ts`, which awaits the same `prepare()` per cold start
 * instead of listening.
 */
async function start(): Promise<void> {
  await prepare();
  app.listen(PORT, HOST, () => {
    // System voice: report state, do not converse.
    console.log(`[FORGE] api listening on http://${HOST}:${PORT}`);
  });
}

void start().catch((err) => {
  // System voice: report state, do not converse.
  console.error('[FORGE] failed to start:', err instanceof Error ? err.message : err);
  process.exit(1);
});
