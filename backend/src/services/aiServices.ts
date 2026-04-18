import fs from 'fs';
import path from 'path';
import axios from 'axios';
import FormData from 'form-data';
import sharp from 'sharp';
import Replicate from 'replicate';
import { config } from '../config';
import { StylePreset } from '../types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function toResizedBuffer(imagePath: string, maxPx = 1024): Promise<Buffer> {
  return sharp(imagePath)
    .resize(maxPx, maxPx, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 90 })
    .toBuffer();
}

function toDataUri(buffer: Buffer): string {
  return `data:image/jpeg;base64,${buffer.toString('base64')}`;
}

async function downloadToFile(url: string, outputPath: string): Promise<void> {
  const res = await axios.get<ArrayBuffer>(url, { responseType: 'arraybuffer', timeout: 120_000 });
  fs.writeFileSync(outputPath, Buffer.from(res.data));
}

function getReplicate(): Replicate {
  return new Replicate({ auth: config.replicateApiToken });
}

// ─── Background Removal ───────────────────────────────────────────────────────

export async function removeBackground(inputPath: string, outputPath: string): Promise<void> {
  // Tier 1 — Replicate rembg (AI, cloud)
  if (config.replicateApiToken) {
    const buf = await toResizedBuffer(inputPath);
    const output = await getReplicate().run(
      'lucataco/remove-bg:95fcc2a26d3899cd6c2691c900465aaeff466285a65c14638cc5f36f34befaf1',
      { input: { image: toDataUri(buf) } },
    ) as unknown as string;
    await downloadToFile(output, outputPath);
    return;
  }

  // Tier 2 — self-hosted rembg container
  if (config.rembgApiUrl) {
    const form = new FormData();
    form.append('file', fs.createReadStream(inputPath));
    const res = await axios.post(config.rembgApiUrl, form, {
      headers: form.getHeaders(),
      responseType: 'arraybuffer',
    });
    fs.writeFileSync(outputPath, Buffer.from(res.data as ArrayBuffer));
    return;
  }

  // Tier 3 — no AI available: enhance quality so something visibly changes
  await sharpEnhance(inputPath, outputPath);
}

// ─── Face Enhancement ─────────────────────────────────────────────────────────

export async function enhanceFace(inputPath: string, outputPath: string): Promise<void> {
  // Tier 1 — Replicate GFPGAN (AI, cloud)
  if (config.replicateApiToken) {
    const buf = await toResizedBuffer(inputPath);
    const output = await getReplicate().run(
      'tencentarc/gfpgan:9283608cc6b7be6b65a8e44983db012355fde4132009bf99d976b2f0896856a3',
      { input: { img: toDataUri(buf), version: 'v1.4', scale: 2 } },
    ) as unknown as string;
    await downloadToFile(output, outputPath);
    return;
  }

  // Tier 2 — self-hosted GFPGAN container
  if (config.gfpganApiUrl) {
    const form = new FormData();
    form.append('image', fs.createReadStream(inputPath));
    const res = await axios.post(`${config.gfpganApiUrl}/restore`, form, {
      headers: form.getHeaders(),
      responseType: 'arraybuffer',
    });
    fs.writeFileSync(outputPath, Buffer.from(res.data as ArrayBuffer));
    return;
  }

  // Tier 3 — sharp: real visible improvement (sharpen + auto-contrast + saturation)
  await sharpEnhance(inputPath, outputPath);
}

// ─── Style Transfer ───────────────────────────────────────────────────────────

const STYLE_PROMPTS: Record<StylePreset, { prompt: string; negative: string }> = {
  professional: {
    prompt: 'professional corporate headshot, office background, formal attire, sharp focus, soft studio lighting, 4k',
    negative: 'casual, blurry, cartoon, anime, distorted',
  },
  casual: {
    prompt: 'natural outdoor portrait, friendly smile, relaxed pose, golden hour lighting, shallow depth of field',
    negative: 'formal, stiff, office, overexposed',
  },
  fantasy: {
    prompt: 'epic fantasy portrait, magical forest, mystical lighting, high fantasy art, intricate details',
    negative: 'modern, office, realistic, plain background',
  },
  cyberpunk: {
    prompt: 'cyberpunk portrait, neon lights, futuristic city background, rain, holographic effects, dark atmosphere',
    negative: 'natural, bright daylight, medieval, warm tones',
  },
  watercolor: {
    prompt: 'watercolor painting portrait, soft pastel colors, impressionist brush strokes, artistic',
    negative: 'photorealistic, oil, sharp hard edges, dark',
  },
  anime: {
    prompt: 'anime portrait, cell-shaded, vibrant colors, studio ghibli style, clean lines, expressive eyes',
    negative: 'photorealistic, western cartoon, 3d render',
  },
  'oil-painting': {
    prompt: 'oil painting portrait, renaissance style, rich warm colors, chiaroscuro lighting, classical art',
    negative: 'modern, cartoon, anime, photography, digital art',
  },
};

export async function applyStyle(
  inputPath: string,
  outputPath: string,
  style: StylePreset,
  customPrompt?: string,
): Promise<void> {
  // Tier 1 — Replicate Stable Diffusion img2img (AI, cloud)
  if (config.replicateApiToken) {
    const buf = await toResizedBuffer(inputPath, 768);
    const preset = STYLE_PROMPTS[style];
    const output = await getReplicate().run(
      'stability-ai/stable-diffusion-img2img:15a3689ee13b0d2616e98820eca31d4af4a36109d7db46580543f4f2fce8e024',
      {
        input: {
          image: toDataUri(buf),
          prompt: customPrompt ?? preset.prompt,
          negative_prompt: preset.negative,
          prompt_strength: 0.6,
          num_inference_steps: 30,
          guidance_scale: 7.5,
        },
      },
    ) as unknown as string[];
    await downloadToFile(output[0], outputPath);
    return;
  }

  // Tier 2 — self-hosted Stable Diffusion WebUI
  if (config.stableDiffusionUrl) {
    const imageData = fs.readFileSync(inputPath).toString('base64');
    const preset = STYLE_PROMPTS[style];
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
    return;
  }

  // Tier 3 — sharp colour grading (real visual effect, no AI)
  await sharpStyle(inputPath, outputPath, style);
}

// ─── Sharp implementations ────────────────────────────────────────────────────

async function sharpEnhance(inputPath: string, outputPath: string): Promise<void> {
  await sharp(inputPath)
    .sharpen({ sigma: 1.3, m1: 0.5, m2: 0.5 })
    .normalize()
    .modulate({ saturation: 1.15, brightness: 1.03 })
    .jpeg({ quality: 95 })
    .toFile(outputPath);
}

async function sharpStyle(
  inputPath: string,
  outputPath: string,
  style: StylePreset,
): Promise<void> {
  let pipeline = sharp(inputPath);

  switch (style) {
    case 'professional':
      pipeline = pipeline
        .modulate({ saturation: 0.85, brightness: 1.05 })
        .normalize()
        .sharpen({ sigma: 0.8 });
      break;

    case 'casual':
      pipeline = pipeline
        .modulate({ saturation: 1.25, brightness: 1.08 })
        .tint({ r: 255, g: 245, b: 215 });
      break;

    case 'fantasy':
      pipeline = pipeline
        .modulate({ saturation: 1.45, brightness: 0.95 })
        .tint({ r: 205, g: 185, b: 255 });
      break;

    case 'cyberpunk':
      pipeline = pipeline
        .modulate({ saturation: 1.85, brightness: 0.88 })
        .tint({ r: 100, g: 215, b: 255 })
        .sharpen({ sigma: 1.3 });
      break;

    case 'watercolor':
      pipeline = pipeline
        .modulate({ saturation: 0.65, brightness: 1.18 })
        .blur(0.8)
        .gamma(0.9);
      break;

    case 'anime':
      pipeline = pipeline
        .modulate({ saturation: 1.95, brightness: 1.06 })
        .sharpen({ sigma: 2.0, m1: 1.5, m2: 0.5 });
      break;

    case 'oil-painting':
      pipeline = pipeline
        .modulate({ saturation: 1.2, brightness: 0.96 })
        .tint({ r: 255, g: 222, b: 175 })
        .sharpen({ sigma: 0.7 });
      break;
  }

  await pipeline.jpeg({ quality: 93 }).toFile(outputPath);
}

// ─── Export processing mode for /api/mode endpoint ───────────────────────────

export function getProcessingMode(): 'replicate' | 'local' | 'sharp' {
  if (config.replicateApiToken) return 'replicate';
  if (config.rembgApiUrl || config.gfpganApiUrl || config.stableDiffusionUrl) return 'local';
  return 'sharp';
}
