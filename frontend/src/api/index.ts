import axios from 'axios';
import { JobStatus, StylePreset } from '../types';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

const api = axios.create({ baseURL: BASE_URL });

export interface UploadResponse {
  jobId: string;
}

export interface StatusResponse {
  status: JobStatus;
  resultUrl?: string;
  error?: string;
}

export async function uploadImage(file: File): Promise<UploadResponse> {
  const form = new FormData();
  form.append('image', file);
  const res = await api.post<{ success: boolean; data: UploadResponse }>('/api/upload', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return res.data.data!;
}

export async function getStatus(jobId: string): Promise<StatusResponse> {
  const res = await api.get<{ success: boolean; data: StatusResponse }>(`/api/status/${jobId}`);
  return res.data.data!;
}

export async function triggerRemoveBg(jobId: string): Promise<void> {
  await api.post(`/api/remove-bg/${jobId}`);
}

export async function triggerApplyStyle(
  jobId: string,
  style: StylePreset,
  prompt?: string,
): Promise<void> {
  await api.post(`/api/apply-style/${jobId}`, { style, prompt });
}

export async function triggerEnhanceFace(jobId: string): Promise<void> {
  await api.post(`/api/enhance-face/${jobId}`);
}

export async function triggerApplyBg(jobId: string, color: string): Promise<void> {
  await api.post(`/api/apply-bg/${jobId}`, { color });
}

export function getResultUrl(jobId: string): string {
  return `${BASE_URL}/api/result/${jobId}`;
}

export type ProcessingMode = 'replicate' | 'huggingface' | 'local' | 'sharp';

export async function fetchMode(): Promise<ProcessingMode> {
  try {
    const res = await api.get<{ success: boolean; data: { mode: ProcessingMode } }>('/api/mode');
    return res.data.data!.mode;
  } catch {
    return 'sharp';
  }
}
