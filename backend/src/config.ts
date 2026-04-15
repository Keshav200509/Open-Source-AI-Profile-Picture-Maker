import path from 'path';

export const config = {
  port: parseInt(process.env.PORT || '4000', 10),
  rembgApiUrl: process.env.REMBG_API_URL || '',
  gfpganApiUrl: process.env.GFPGAN_API_URL || '',
  stableDiffusionUrl: process.env.STABLE_DIFFUSION_URL || '',
  cleanupIntervalMs: parseInt(process.env.CLEANUP_INTERVAL_MS || '3600000', 10),
  maxFileSizeMb: parseInt(process.env.MAX_FILE_SIZE_MB || '10', 10),
  tempDir: path.join(__dirname, '../temp'),
};
