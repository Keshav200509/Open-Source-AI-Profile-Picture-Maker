import { Router, Request, Response } from 'express';
import { getJob } from '../services/jobStore';

const router = Router();

router.get('/:jobId', (req: Request, res: Response) => {
  const job = getJob(req.params.jobId);
  if (!job) {
    res.status(404).json({ success: false, error: 'Job not found or expired' });
    return;
  }
  const resultUrl = job.status === 'completed' ? `/api/result/${job.id}` : undefined;
  res.json({
    success: true,
    data: { status: job.status, resultUrl, error: job.error },
  });
});

export default router;
