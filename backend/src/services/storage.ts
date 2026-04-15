import fs from 'fs';
import path from 'path';
import { config } from '../config';

export function ensureTempDir(): void {
  if (!fs.existsSync(config.tempDir)) {
    fs.mkdirSync(config.tempDir, { recursive: true });
  }
}

export function ensureJobDir(jobId: string): string {
  const dir = path.join(config.tempDir, jobId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function getJobDir(jobId: string): string {
  return path.join(config.tempDir, jobId);
}

export function getFilePath(jobId: string, filename: string): string {
  return path.join(config.tempDir, jobId, filename);
}

export function saveFile(jobId: string, buffer: Buffer, filename: string): string {
  const dir = ensureJobDir(jobId);
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

export function fileExists(jobId: string, filename: string): boolean {
  return fs.existsSync(getFilePath(jobId, filename));
}

export function deleteJobDir(jobId: string): void {
  const dir = getJobDir(jobId);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export function imageFilename(mimeType: string, prefix = 'original'): string {
  const ext = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
  return `${prefix}.${ext}`;
}
