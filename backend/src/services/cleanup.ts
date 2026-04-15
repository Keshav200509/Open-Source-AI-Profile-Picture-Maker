import { config } from '../config';
import { getAllJobs, deleteJob } from './jobStore';
import { deleteJobDir } from './storage';

const MAX_AGE_MS = 60 * 60 * 1000; // 1 hour

export function runCleanup(): void {
  const now = Date.now();
  for (const job of getAllJobs()) {
    if (now - job.createdAt > MAX_AGE_MS) {
      deleteJobDir(job.id);
      deleteJob(job.id);
    }
  }
}

export function startCleanupScheduler(): void {
  runCleanup();
  setInterval(runCleanup, config.cleanupIntervalMs);
}
