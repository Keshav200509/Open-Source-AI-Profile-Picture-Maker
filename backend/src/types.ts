export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed';

export type StylePreset =
  | 'professional'
  | 'fantasy'
  | 'cyberpunk'
  | 'anime';

export interface SelfieJob {
  id: string;
  status: JobStatus;
  createdAt: number;
  updatedAt: number;
  originalFile: string;
  resultFile?: string;
  error?: string;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}
