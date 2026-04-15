import fs from 'fs';
import axios from 'axios';
import FormData from 'form-data';
import { config } from '../config';
import { StylePreset } from '../types';

const STYLE_PROMPTS: Record<StylePreset, { prompt: string; negative: string }> = {
  professional: {
    prompt:
      'professional corporate headshot, office background, formal attire, sharp focus, soft studio lighting, 4k',
    negative: 'casual, blurry, cartoon, anime, distorted',
  },
  casual: {
    prompt:
      'natural outdoor portrait, friendly smile, relaxed pose, golden hour lighting, shallow depth of field',
    negative: 'formal, office, stiff, overexposed',
  },
  fantasy: {
    prompt:
      'epic fantasy portrait, magical forest background, mystical lighting, high fantasy art, intricate details',
    negative: 'modern, office, realistic, plain background',
  },
  cyberpunk: {
    prompt:
      'cyberpunk portrait, neon lights, futuristic city background, rain, holographic effects, dark atmosphere',
    negative: 'natural, bright daylight, medieval, warm tones',
  },
  watercolor: {
    prompt:
      'watercolor painting portrait, soft pastel colors, impressionist brush strokes, artistic, delicate washes',
    negative: 'photorealistic, oil paint, sharp hard edges, dark',
  },
  anime: {
    prompt:
      'anime portrait, cell-shaded, vibrant colors, studio ghibli style, clean lines, expressive eyes',
    negative: 'photorealistic, western cartoon, 3d render',
  },
  'oil-painting': {
    prompt:
      'oil painting portrait, renaissance style, rich warm colors, chiaroscuro lighting, classical art, museum quality',
    negative: 'modern, cartoon, anime, photography, digital art',
  },
};

async function mock(inputPath: string, outputPath: string): Promise<void> {
  await new Promise<void>((res) => setTimeout(res, 1000));
  fs.copyFileSync(inputPath, outputPath);
}

export async function removeBackground(inputPath: string, outputPath: string): Promise<void> {
  if (!config.rembgApiUrl) {
    return mock(inputPath, outputPath);
  }
  const form = new FormData();
  form.append('file', fs.createReadStream(inputPath));
  const res = await axios.post(config.rembgApiUrl, form, {
    headers: form.getHeaders(),
    responseType: 'arraybuffer',
  });
  fs.writeFileSync(outputPath, Buffer.from(res.data as ArrayBuffer));
}

export async function applyStyle(
  inputPath: string,
  outputPath: string,
  style: StylePreset,
  customPrompt?: string,
): Promise<void> {
  if (!config.stableDiffusionUrl) {
    return mock(inputPath, outputPath);
  }
  const imageData = fs.readFileSync(inputPath).toString('base64');
  const preset = STYLE_PROMPTS[style] ?? STYLE_PROMPTS.professional;
  const res = await axios.post<{ images: string[] }>(
    `${config.stableDiffusionUrl}/sdapi/v1/img2img`,
    {
      init_images: [imageData],
      prompt: customPrompt ?? preset.prompt,
      negative_prompt: preset.negative,
      denoising_strength: 0.65,
      steps: 30,
      cfg_scale: 7,
      width: 512,
      height: 512,
    },
  );
  fs.writeFileSync(outputPath, Buffer.from(res.data.images[0], 'base64'));
}

export async function enhanceFace(inputPath: string, outputPath: string): Promise<void> {
  if (!config.gfpganApiUrl) {
    return mock(inputPath, outputPath);
  }
  const form = new FormData();
  form.append('image', fs.createReadStream(inputPath));
  const res = await axios.post(`${config.gfpganApiUrl}/restore`, form, {
    headers: form.getHeaders(),
    responseType: 'arraybuffer',
  });
  fs.writeFileSync(outputPath, Buffer.from(res.data as ArrayBuffer));
}
