import { Router, Request, Response } from 'express';
import { getJob, updateJob } from '../services/jobStore';
import { getFilePath } from '../services/storage';
import { applyStyle } from '../services/aiServices';
import { StylePreset } from '../types';

const VALID_STYLES: StylePreset[] = [
  'professional',
  'fantasy',
  'cyberpunk',
  'anime',
];

const router = Router();

router.post('/:jobId', (req: Request, res: Response) => {
  const job = getJob(req.params.jobId);
  if (!job) {
    res.status(404).json({ success: false, error: 'Job not found or expired' });
    return;
  }
  if (job.status === 'processing') {
    res.status(409).json({ success: false, error: 'Job is already processing' });
    return;
  }

  const style = req.body.style as StylePreset;
  const prompt = req.body.prompt as string | undefined;

  if (!VALID_STYLES.includes(style)) {
    res.status(400).json({ success: false, error: 'Invalid style preset' });
    return;
  }

  updateJob(job.id, { status: 'processing' });
  res.status(202).json({ success: true, data: { message: 'Style transfer started' } });

  const inputPath = getFilePath(job.id, job.resultFile ?? job.originalFile);
  const outputPath = getFilePath(job.id, 'result.jpg');

  applyStyle(inputPath, outputPath, style, prompt)
    .then(() => updateJob(job.id, { status: 'completed', resultFile: 'result.jpg' }))
    .catch((err: Error) => updateJob(job.id, { status: 'failed', error: err.message }));
});

export default router;
