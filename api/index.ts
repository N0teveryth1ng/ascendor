/**
 * Vercel serverless entry for the Forge API.
 *
 * Vercel detects a Node function under `api/` and routes matching requests here.
 * The Express app is built once per cold start; migrations and account seeding
 * are awaited before the first request is served, so a cold start can never
 * answer from an unmigrated database.
 *
 * `@vercel/node` is resolved lazily so the local dev flow (`tsx watch src/index.ts`)
 * never needs it installed.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { app, prepare } from '../server/src/app.js';

let ready: Promise<void> | null = null;

/** One migration + seed pass per cold start, shared by concurrent invocations. */
function ensureReady(): Promise<void> {
  ready ??= prepare().catch((err: unknown) => {
    // Clear the memo so a transient failure is retried on the next invocation
    // rather than poisoning every later request in this instance.
    ready = null;
    throw err;
  });
  return ready;
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    await ensureReady();
  } catch (err) {
    res.statusCode = 503;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: 'DATABASE UNAVAILABLE' }));
    console.error('[FORGE] prepare failed:', err instanceof Error ? err.message : err);
    return;
  }
  app(req, res);
}
