import express from 'express';
import cors from 'cors';
import { api, errorHandler } from './routes/api.js';
import { authRoutes } from './routes/auth.js';
import { dataRoutes, teacherRoutes } from './routes/data.js';
import { attachUser } from './middleware/auth.js';
import { migrate } from './db/index.js';
import { seedAccounts } from './service/seed.js';

/**
 * Express app construction, kept separate from the process entry point so the
 * Vercel serverless handler (`api/index.ts`) can mount this exact app without
 * also opening a TCP listener. Nothing here listens or migrates; `prepare()`
 * is exported for both entry points to await on cold start.
 */
export const app = express();

app.use(cors({ credentials: true }));
app.use(express.json({ limit: '2mb' }));

app.use(attachUser);

app.use('/api/auth', authRoutes);
app.use('/api', dataRoutes);
app.use('/api/teacher', teacherRoutes);
app.use('/api', api);

app.use((_req, res) => {
  res.status(404).json({ error: 'NOT FOUND' });
});

app.use(errorHandler);

/**
 * Applies the schema and any fixtures. Safe to call more than once: every DDL
 * statement is `IF NOT EXISTS` and seeding skips accounts that already exist,
 * so a serverless cold start can await this on every invocation.
 */
export async function prepare(): Promise<void> {
  await migrate();
  await seedAccounts();
}
