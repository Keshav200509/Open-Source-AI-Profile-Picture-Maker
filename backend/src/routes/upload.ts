import { Router, Request, Response } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import { createJob } from '../services/jobStore';
import { saveFile, imageFilename } from '../services/storage';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxFileSizeMb * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    // Silently reject — the !req.file guard below returns a clean 400
    cb(null, allowed.includes(file.mimetype));
  },
});

router.post('/', upload.single('image'), (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ success: false, error: 'No image file provided' });
    return;
  }
  const jobId = uuidv4();
  const filename = imageFilename(req.file.mimetype, 'original');
  saveFile(jobId, req.file.buffer, filename);
  createJob(jobId, filename);
  res.status(201).json({ success: true, data: { jobId } });
});

export default router;
