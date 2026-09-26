import express from 'express';
import cors from 'cors';
import { api, errorHandler } from './routes/api.js';
import { authRoutes } from './routes/auth.js';
import { dataRoutes, teacherRoutes } from './routes/data.js';
import { attachUser } from './middleware/auth.js';
import { getDb } from './db/index.js';
import { seedAccounts } from './service/seed.js';

const PORT = Number(process.env.PORT ?? 5174);
const HOST = process.env.HOST ?? '127.0.0.1';

const app = express();
app.use(cors({ credentials: true }));
app.use(express.json({ limit: '2mb' }));

getDb();
seedAccounts();

app.use(attachUser);

app.use('/api/auth', authRoutes);
app.use('/api', dataRoutes);
app.use('/api/teacher', teacherRoutes);
app.use('/api', api);

app.use((_req, res) => {
  res.status(404).json({ error: 'NOT FOUND' });
});

app.use(errorHandler);

app.listen(PORT, HOST, () => {
  // System voice: report state, do not converse.
  console.log(`[FORGE] api listening on http://${HOST}:${PORT}`);
});
