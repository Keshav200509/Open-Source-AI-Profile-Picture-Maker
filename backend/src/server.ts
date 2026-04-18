import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { config } from './config';
import { ensureTempDir } from './services/storage';
import { initJobStore } from './services/jobStore';
import { startCleanupScheduler, runCleanup } from './services/cleanup';
import { getProcessingMode } from './services/aiServices';
import uploadRouter from './routes/upload';
import statusRouter from './routes/status';
import removeBgRouter from './routes/removeBg';
import applyStyleRouter from './routes/applyStyle';
import enhanceFaceRouter from './routes/enhanceFace';
import resultRouter from './routes/result';

const app = express();

app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Initialise persistent storage and in-memory job store
ensureTempDir();
initJobStore();
startCleanupScheduler();

// Routes
app.use('/api/upload', uploadRouter);
app.use('/api/status', statusRouter);
app.use('/api/remove-bg', removeBgRouter);
app.use('/api/apply-style', applyStyleRouter);
app.use('/api/enhance-face', enhanceFaceRouter);
app.use('/api/result', resultRouter);

// Manual cleanup trigger (for external cron)
app.post('/api/cleanup', (_req, res) => {
  runCleanup();
  res.json({ success: true, data: { message: 'Cleanup completed' } });
});

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Processing mode — lets the frontend show which tier is active
app.get('/api/mode', (_req, res) => {
  res.json({ success: true, data: { mode: getProcessingMode() } });
});

// Serve React frontend — must be registered after all API routes
const frontendDist = path.resolve(__dirname, '../../frontend/dist');
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
}

app.listen(config.port, () => {
  console.log(`Backend running on http://localhost:${config.port}`);
});
