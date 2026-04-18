import fs from 'fs';
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

// ─── HuggingFace Real-ESRGAN (Tier 1.5) ──────────────────────────────────────
// Free 4× super-resolution. Returns true on success so callers fall through
// to sharp on any failure — the HF free tier has cold-starts and queues.

async function huggingFaceEnhance(inputPath: string, outputPath: string): Promise<boolean> {
  if (!config.hfApiToken) return false;
  try {
    const imageBuffer = fs.readFileSync(inputPath);

    const attempt = async (timeoutMs: number) =>
      axios.post(
        'https://api-inference.huggingface.co/models/ai-forever/Real-ESRGAN',
        imageBuffer,
        {
          headers: {
            Authorization: `Bearer ${config.hfApiToken}`,
            'Content-Type': 'application/octet-stream',
          },
          responseType: 'arraybuffer',
          timeout: timeoutMs,
          validateStatus: () => true,
        },
      );

    let res = await attempt(30_000);

    // 503 = model cold-starting — wait 20 s then retry with a longer timeout
    if (res.status === 503) {
      await new Promise((r) => setTimeout(r, 20_000));
      res = await attempt(90_000);
    }

    if (res.status !== 200) return false;

    // Cap at 2048 px and normalise quality before saving
    const upscaled = await sharp(Buffer.from(res.data as ArrayBuffer))
      .resize(2048, 2048, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 96 })
      .toBuffer();

    fs.writeFileSync(outputPath, upscaled);
    return true;
  } catch {
    return false;
  }
}

// ─── Background Removal ───────────────────────────────────────────────────────

export async function removeBackground(inputPath: string, outputPath: string): Promise<void> {
  if (config.replicateApiToken) {
    const buf = await toResizedBuffer(inputPath);
    const output = await getReplicate().run(
      'lucataco/remove-bg:95fcc2a26d3899cd6c2691c900465aaeff466285a65c14638cc5f36f34befaf1',
      { input: { image: toDataUri(buf) } },
    ) as unknown as string;
    await downloadToFile(output, outputPath);
    return;
  }

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

  await sharpEnhance(inputPath, outputPath);
}

// ─── Face Enhancement ─────────────────────────────────────────────────────────

export async function enhanceFace(inputPath: string, outputPath: string): Promise<void> {
  // Tier 1 — Replicate GFPGAN: full AI face restoration + 2× upscale
  if (config.replicateApiToken) {
    const buf = await toResizedBuffer(inputPath);
    const output = await getReplicate().run(
      'tencentarc/gfpgan:9283608cc6b7be6b65a8e44983db012355fde4132009bf99d976b2f0896856a3',
      { input: { img: toDataUri(buf), version: 'v1.4', scale: 2 } },
    ) as unknown as string;
    await downloadToFile(output, outputPath);
    return;
  }

  // Tier 1.5 — HuggingFace Real-ESRGAN: free 4× super-resolution
  if (await huggingFaceEnhance(inputPath, outputPath)) return;

  // Tier 2 — self-hosted GFPGAN
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

  // Tier 3 — sharp (no AI required, always produces a clean result)
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

  await sharpStyle(inputPath, outputPath, style);
}

// ─── Sharp Tier 3: Enhance Face ───────────────────────────────────────────────
// Safe pipeline that always produces a clean, visibly improved result.
// Rules: no per-channel histogram ops (cause false-colour), no double-pass
// sharpening (halos), no linear() with untested offsets.
//
//  1. 1.5× Lanczos3 upscale   — larger output is itself a visible win
//  2. normalize()             — global histogram stretch, hue-safe
//  3. sharpen sigma 1.3       — visible crispness on face/hair/glasses
//     m1 0.9 / m2 0.1        — aggressively sharpen flat regions (skin),
//                               barely touch high-contrast edges (avoids
//                               chromatic haloing at hair-background border)
//  4. modulate sat 1.28       — +28 % saturation: clearly more vivid
//  5. JPEG 96                 — near-lossless, no block recompression noise

async function sharpEnhance(inputPath: string, outputPath: string): Promise<void> {
  const { width: w = 800, height: h = 1000 } = await sharp(inputPath).metadata();

  const scale  = Math.min(1.5, 2048 / Math.max(w, h));
  const targetW = Math.round(w * scale);
  const targetH = Math.round(h * scale);

  await sharp(inputPath)
    .resize(targetW, targetH, { kernel: sharp.kernel.lanczos3, withoutEnlargement: false })
    .normalize()
    .sharpen({ sigma: 1.3, m1: 0.9, m2: 0.1 })
    .modulate({ saturation: 1.28, brightness: 1.03 })
    .jpeg({ quality: 96 })
    .toFile(outputPath);
}

// ─── Sharp Tier 3: Style Presets ─────────────────────────────────────────────
// Each preset applies a strong but artefact-free colour grade.
// Order matters: normalize before tint so the tint colour reads cleanly.

async function sharpStyle(
  inputPath: string,
  outputPath: string,
  style: StylePreset,
): Promise<void> {
  let pipeline = sharp(inputPath);

  switch (style) {
    // Cool studio: desaturate → crisp → cold blue-white tint
    case 'professional':
      pipeline = pipeline
        .normalize()
        .modulate({ saturation: 0.72, brightness: 1.08 })
        .sharpen({ sigma: 1.1, m1: 0.9, m2: 0.2 })
        .tint({ r: 205, g: 220, b: 248 });
      break;

    // Golden hour: warm, lifted, vibrant — feels like outdoor sunlight
    case 'casual':
      pipeline = pipeline
        .modulate({ saturation: 1.6, brightness: 1.16 })
        .tint({ r: 255, g: 240, b: 198 })
        .sharpen({ sigma: 0.6 });
      break;

    // Mystical: deep purple cast, high saturation, dark midtones
    case 'fantasy':
      pipeline = pipeline
        .normalize()
        .modulate({ saturation: 2.0, brightness: 0.90 })
        .tint({ r: 170, g: 150, b: 255 });
      break;

    // Neon city: electric cyan, extreme saturation, deep shadows
    case 'cyberpunk':
      pipeline = pipeline
        .modulate({ saturation: 2.5, brightness: 0.78 })
        .tint({ r: 55, g: 185, b: 255 })
        .sharpen({ sigma: 1.5, m1: 1.0, m2: 0.2 });
      break;

    // Soft pastel: heavily desaturated, blurred, lifted — painted feel
    case 'watercolor':
      pipeline = pipeline
        .modulate({ saturation: 0.42, brightness: 1.30 })
        .blur(1.6)
        .gamma(0.85)
        .tint({ r: 250, g: 246, b: 255 });
      break;

    // Cell-shaded: hyper-saturated, aggressive edge sharpening
    case 'anime':
      pipeline = pipeline
        .normalize()
        .modulate({ saturation: 2.7, brightness: 1.12 })
        .sharpen({ sigma: 2.2, m1: 2.0, m2: 0.15 });
      break;

    // Old master: amber glaze, slight blur for paint texture, rich shadows
    case 'oil-painting':
      pipeline = pipeline
        .modulate({ saturation: 1.5, brightness: 0.89 })
        .blur(0.9)
        .tint({ r: 255, g: 208, b: 138 })
        .sharpen({ sigma: 0.7, m1: 0.5, m2: 0.15 });
      break;
  }

  await pipeline.jpeg({ quality: 94 }).toFile(outputPath);
}

// ─── Background Fill ─────────────────────────────────────────────────────────
// Replaces transparent pixels (e.g. after rembg) with the given hex color.
// On opaque images the flatten is a no-op — the result is the same image,
// which is correct: the user should remove the background first.

export async function applyBackground(
  inputPath: string,
  outputPath: string,
  hexColor: string,
): Promise<void> {
  const hex = hexColor.replace('#', '');
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);

  await sharp(inputPath)
    .flatten({ background: { r, g, b } })
    .jpeg({ quality: 95 })
    .toFile(outputPath);
}

// ─── Processing mode ──────────────────────────────────────────────────────────

export function getProcessingMode(): 'replicate' | 'huggingface' | 'local' | 'sharp' {
  if (config.replicateApiToken) return 'replicate';
  if (config.hfApiToken) return 'huggingface';
  if (config.rembgApiUrl || config.gfpganApiUrl || config.stableDiffusionUrl) return 'local';
  return 'sharp';
}
