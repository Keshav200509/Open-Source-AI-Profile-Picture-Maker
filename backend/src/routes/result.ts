import { Router, Request, Response } from 'express';
import { getJob } from '../services/jobStore';
import { getFilePath, fileExists } from '../services/storage';

const router = Router();

router.get('/:jobId', (req: Request, res: Response) => {
  const job = getJob(req.params.jobId);
  if (!job) {
    res.status(404).json({ success: false, error: 'Job not found or expired' });
    return;
  }
  if (job.status !== 'completed' || !job.resultFile) {
    res.status(404).json({ success: false, error: 'Result not ready' });
    return;
  }
  if (!fileExists(job.id, job.resultFile)) {
    res.status(404).json({ success: false, error: 'Result file not found' });
    return;
  }
  const filePath = getFilePath(job.id, job.resultFile);
  res.setHeader('Content-Disposition', `inline; filename="${job.resultFile}"`);
  res.sendFile(filePath);
});

export default router;
