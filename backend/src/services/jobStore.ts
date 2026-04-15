import fs from 'fs';
import path from 'path';
import { SelfieJob } from '../types';
import { config } from '../config';

const jobs = new Map<string, SelfieJob>();
const JOBS_FILE = path.join(config.tempDir, '_jobs.json');

function persist(): void {
  try {
    fs.writeFileSync(JOBS_FILE, JSON.stringify(Array.from(jobs.entries())), 'utf8');
  } catch {
    // ignore write errors — in-memory store still works
  }
}

function load(): void {
  try {
    if (fs.existsSync(JOBS_FILE)) {
      const entries = JSON.parse(fs.readFileSync(JOBS_FILE, 'utf8')) as [string, SelfieJob][];
      for (const [k, v] of entries) {
        jobs.set(k, v);
      }
    }
  } catch {
    // ignore parse errors
  }
}

export function initJobStore(): void {
  load();
}

export function createJob(id: string, originalFile: string): SelfieJob {
  const job: SelfieJob = {
    id,
    status: 'pending',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    originalFile,
  };
  jobs.set(id, job);
  persist();
  return job;
}

export function getJob(id: string): SelfieJob | undefined {
  return jobs.get(id);
}

export function updateJob(id: string, updates: Partial<SelfieJob>): SelfieJob | undefined {
  const job = jobs.get(id);
  if (!job) return undefined;
  const updated: SelfieJob = { ...job, ...updates, updatedAt: Date.now() };
  jobs.set(id, updated);
  persist();
  return updated;
}

export function deleteJob(id: string): void {
  jobs.delete(id);
  persist();
}

export function getAllJobs(): SelfieJob[] {
  return Array.from(jobs.values());
}
