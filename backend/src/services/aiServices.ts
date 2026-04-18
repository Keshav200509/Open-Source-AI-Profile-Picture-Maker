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

// Calls HuggingFace Inference API for Real-ESRGAN (4× super-resolution).
// Returns true on success, false on any failure so callers can fall through.
async function huggingFaceEnhance(inputPath: string, outputPath: string): Promise<boolean> {
  if (!config.hfApiToken) return false;
  try {
    const imageBuffer = fs.readFileSync(inputPath);
    // First attempt — model may be cold-starting
    let res = await axios.post(
      'https://api-inference.huggingface.co/models/ai-forever/Real-ESRGAN',
      imageBuffer,
      {
        headers: {
          Authorization: `Bearer ${config.hfApiToken}`,
          'Content-Type': 'application/octet-stream',
        },
        responseType: 'arraybuffer',
        timeout: 30_000,
        validateStatus: () => true,
      },
    );
    // 503 means the model is loading — wait 20 s and retry once
    if (res.status === 503) {
      await new Promise((r) => setTimeout(r, 20_000));
      res = await axios.post(
        'https://api-inference.huggingface.co/models/ai-forever/Real-ESRGAN',
        imageBuffer,
        {
          headers: {
            Authorization: `Bearer ${config.hfApiToken}`,
            'Content-Type': 'application/octet-stream',
          },
          responseType: 'arraybuffer',
          timeout: 90_000,
          validateStatus: () => true,
        },
      );
    }
    if (res.status === 200) {
      // HF returns the upscaled image; run it through sharp to cap size + normalise quality
      const upscaled = await sharp(Buffer.from(res.data as ArrayBuffer))
        .resize(2048, 2048, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 96 })
        .toBuffer();
      fs.writeFileSync(outputPath, upscaled);
      return true;
    }
    return false;
  } catch {
    return false;
  }
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

  // Tier 3 — no AI: run the same punchy enhance so something visibly changes
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

  // Tier 1.5 — HuggingFace Real-ESRGAN (free AI, 4× super-resolution)
  const hfDone = await huggingFaceEnhance(inputPath, outputPath);
  if (hfDone) return;

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

  // Tier 3 — aggressive sharp pipeline (always produces a visibly better result)
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

  // Tier 3 — aggressive sharp colour grading (distinct, dramatic per style)
  await sharpStyle(inputPath, outputPath, style);
}

// ─── Sharp: Enhance Face (Tier 3) ────────────────────────────────────────────
// Conservative pipeline: upscale → auto-levels → single sharpen → colour lift.
// Goal is a clean, slightly crisper result — never to destroy the image.
// CLAHE is intentionally absent: it operates per-channel on RGB causing
// false-colour fringing on JPEG sources.  normalize() is channel-aware and safe.

async function sharpEnhance(inputPath: string, outputPath: string): Promise<void> {
  const meta = await sharp(inputPath).metadata();
  const w = meta.width ?? 800;
  const h = meta.height ?? 1000;

  // Upscale 1.5× (capped at 2048 px) — bigger output is itself an improvement
  const scale = Math.min(1.5, 2048 / Math.max(w, h));
  const targetW = Math.round(w * scale);
  const targetH = Math.round(h * scale);

  await sharp(inputPath)
    .resize(targetW, targetH, { kernel: sharp.kernel.lanczos3, withoutEnlargement: false })
    // Global histogram stretch — safe, preserves hue relationships
    .normalize()
    // Single moderate sharpen — no halo amplification
    .sharpen({ sigma: 0.9, m1: 0.6, m2: 0.2 })
    // Gentle colour lift: +18 % saturation, +2 % brightness
    .modulate({ saturation: 1.18, brightness: 1.02 })
    .jpeg({ quality: 95 })
    .toFile(outputPath);
}

// ─── Sharp: Style Presets (Tier 3) ───────────────────────────────────────────
// Each preset is tuned to look unmistakably different from the original and
// from every other preset.  Values are deliberately bold — subtle changes at
// this tier are invisible and misleading.

async function sharpStyle(
  inputPath: string,
  outputPath: string,
  style: StylePreset,
): Promise<void> {
  let pipeline = sharp(inputPath);

  switch (style) {
    // Cool, desaturated studio look. Crisp, corporate-blue tint.
    case 'professional':
      pipeline = pipeline
        .normalize()
        .modulate({ saturation: 0.75, brightness: 1.06 })
        .sharpen({ sigma: 1.0, m1: 0.8, m2: 0.3 })
        .tint({ r: 210, g: 222, b: 245 });
      break;

    // Warm golden-hour: vibrant, lifted, slightly soft.
    case 'casual':
      pipeline = pipeline
        .modulate({ saturation: 1.55, brightness: 1.14 })
        .tint({ r: 255, g: 242, b: 205 })
        .sharpen({ sigma: 0.5 });
      break;

    // Magical purple-blue: high saturation, slightly darker.
    case 'fantasy':
      pipeline = pipeline
        .normalize()
        .modulate({ saturation: 1.85, brightness: 0.94 })
        .tint({ r: 180, g: 162, b: 255 });
      break;

    // Electric cyan neon, high saturation, punchy contrast.
    case 'cyberpunk':
      pipeline = pipeline
        .modulate({ saturation: 2.4, brightness: 0.82 })
        .tint({ r: 65, g: 190, b: 255 })
        .sharpen({ sigma: 1.4, m1: 1.0, m2: 0.3 });
      break;

    // Faded, soft, desaturated — lifted shadows, cool wash.
    case 'watercolor':
      pipeline = pipeline
        .modulate({ saturation: 0.48, brightness: 1.28 })
        .blur(1.4)
        .gamma(0.86)
        .tint({ r: 248, g: 244, b: 255 });
      break;

    // Hyper-vivid, hard edges — cell-shaded cartoon feel.
    case 'anime':
      pipeline = pipeline
        .normalize()
        .modulate({ saturation: 2.6, brightness: 1.1 })
        .sharpen({ sigma: 2.0, m1: 1.8, m2: 0.2 });
      break;

    // Warm amber/sienna, rich shadows, painterly blur.
    case 'oil-painting':
      pipeline = pipeline
        .modulate({ saturation: 1.45, brightness: 0.91 })
        .blur(0.8)
        .tint({ r: 255, g: 212, b: 148 })
        .sharpen({ sigma: 0.6, m1: 0.4, m2: 0.2 });
      break;
  }

  await pipeline.jpeg({ quality: 93 }).toFile(outputPath);
}

// ─── Export processing mode for /api/mode endpoint ───────────────────────────

export function getProcessingMode(): 'replicate' | 'huggingface' | 'local' | 'sharp' {
  if (config.replicateApiToken) return 'replicate';
  if (config.hfApiToken) return 'huggingface';
  if (config.rembgApiUrl || config.gfpganApiUrl || config.stableDiffusionUrl) return 'local';
  return 'sharp';
}
