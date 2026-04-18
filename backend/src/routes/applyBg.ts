import { Router, Request, Response } from 'express';
import { getJob, updateJob } from '../services/jobStore';
import { getFilePath } from '../services/storage';
import { applyBackground } from '../services/aiServices';

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

  const { color } = req.body as { color?: string };
  if (!color || !/^#[0-9a-fA-F]{6}$/.test(color)) {
    res.status(400).json({ success: false, error: 'color must be a hex string like #rrggbb' });
    return;
  }

  updateJob(job.id, { status: 'processing' });
  res.status(202).json({ success: true, data: { message: 'Background fill started' } });

  const inputPath = getFilePath(job.id, job.resultFile ?? job.originalFile);
  const outputPath = getFilePath(job.id, 'result.jpg');

  applyBackground(inputPath, outputPath, color)
    .then(() => updateJob(job.id, { status: 'completed', resultFile: 'result.jpg' }))
    .catch((err: Error) => updateJob(job.id, { status: 'failed', error: err.message }));
});

export default router;
