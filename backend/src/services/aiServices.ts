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

// Shared retry wrapper for HuggingFace Inference API calls.
// Returns the response buffer on success, null on any failure (caller falls through).
async function hfInference(model: string, imageBuffer: Buffer): Promise<Buffer | null> {
  if (!config.hfApiToken) return null;
  try {
    const post = (ms: number) =>
      axios.post(`https://api-inference.huggingface.co/models/${model}`, imageBuffer, {
        headers: { Authorization: `Bearer ${config.hfApiToken}`, 'Content-Type': 'application/octet-stream' },
        responseType: 'arraybuffer',
        timeout: ms,
        validateStatus: () => true,
      });

    let res = await post(30_000);
    if (res.status === 503) {
      await new Promise((r) => setTimeout(r, 20_000));
      res = await post(90_000);
    }
    return res.status === 200 ? Buffer.from(res.data as ArrayBuffer) : null;
  } catch {
    return null;
  }
}

// ─── Background Removal ───────────────────────────────────────────────────────

export async function removeBackground(inputPath: string, outputPath: string): Promise<void> {
  // Tier 1 — Replicate rembg
  if (config.replicateApiToken) {
    const buf = await toResizedBuffer(inputPath);
    const output = await getReplicate().run(
      'lucataco/remove-bg:95fcc2a26d3899cd6c2691c900465aaeff466285a65c14638cc5f36f34befaf1',
      { input: { image: toDataUri(buf) } },
    ) as unknown as string;
    await downloadToFile(output, outputPath);
    return;
  }

  // Tier 1.5 — HuggingFace RMBG-1.4 (free, real background removal)
  if (config.hfApiToken) {
    const imageBuffer = fs.readFileSync(inputPath);
    const result = await hfInference('briaai/RMBG-1.4', imageBuffer);
    if (result) { fs.writeFileSync(outputPath, result); return; }
  }

  // Tier 2 — self-hosted rembg container
  if (config.rembgApiUrl) {
    const form = new FormData();
    form.append('file', fs.createReadStream(inputPath));
    const res = await axios.post(config.rembgApiUrl, form, {
      headers: form.getHeaders(), responseType: 'arraybuffer',
    });
    fs.writeFileSync(outputPath, Buffer.from(res.data as ArrayBuffer));
    return;
  }

  // Tier 3 — no AI available: enhance quality (cannot truly remove background)
  await sharpEnhance(inputPath, outputPath);
}

// ─── Face Enhancement ─────────────────────────────────────────────────────────

export async function enhanceFace(inputPath: string, outputPath: string): Promise<void> {
  // Tier 1 — Replicate GFPGAN
  if (config.replicateApiToken) {
    const buf = await toResizedBuffer(inputPath);
    const output = await getReplicate().run(
      'tencentarc/gfpgan:9283608cc6b7be6b65a8e44983db012355fde4132009bf99d976b2f0896856a3',
      { input: { img: toDataUri(buf), version: 'v1.4', scale: 2 } },
    ) as unknown as string;
    await downloadToFile(output, outputPath);
    return;
  }

  // Tier 1.5 — HuggingFace Real-ESRGAN (4× super-resolution)
  if (config.hfApiToken) {
    const imageBuffer = fs.readFileSync(inputPath);
    const result = await hfInference('ai-forever/Real-ESRGAN', imageBuffer);
    if (result) {
      const capped = await sharp(result)
        .resize(2048, 2048, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 96 })
        .toBuffer();
      fs.writeFileSync(outputPath, capped);
      return;
    }
  }

  // Tier 2 — self-hosted GFPGAN
  if (config.gfpganApiUrl) {
    const form = new FormData();
    form.append('image', fs.createReadStream(inputPath));
    const res = await axios.post(`${config.gfpganApiUrl}/restore`, form, {
      headers: form.getHeaders(), responseType: 'arraybuffer',
    });
    fs.writeFileSync(outputPath, Buffer.from(res.data as ArrayBuffer));
    return;
  }

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
  // Tier 1 — Replicate Stable Diffusion img2img
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
        steps: 30, cfg_scale: 7, width: 512, height: 512,
      },
    );
    fs.writeFileSync(outputPath, Buffer.from(res.data.images[0], 'base64'));
    return;
  }

  await sharpStyle(inputPath, outputPath, style);
}

// ─── Background Fill ──────────────────────────────────────────────────────────

export async function applyBackground(
  inputPath: string,
  outputPath: string,
  hexColor: string,
): Promise<void> {
  const hex = hexColor.replace('#', '');
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);

  // .flatten() replaces transparent pixels with the bg colour.
  // On opaque images it is a no-op — user should remove background first.
  const buf = await sharp(inputPath)
    .flatten({ background: { r, g, b } })
    .jpeg({ quality: 95 })
    .toBuffer();
  fs.writeFileSync(outputPath, buf);
}

// ─── Sharp Tier 3: Enhance Face ───────────────────────────────────────────────
// Uses .toBuffer() so input and output can safely be the same path.

async function sharpEnhance(inputPath: string, outputPath: string): Promise<void> {
  const { width: w = 800, height: h = 1000 } = await sharp(inputPath).metadata();
  const scale  = Math.min(1.5, 2048 / Math.max(w, h));

  const buf = await sharp(inputPath)
    .resize(Math.round(w * scale), Math.round(h * scale), {
      kernel: sharp.kernel.lanczos3,
      withoutEnlargement: false,
    })
    .normalize()
    .sharpen({ sigma: 1.3, m1: 0.9, m2: 0.1 })
    .modulate({ saturation: 1.28, brightness: 1.03 })
    .jpeg({ quality: 96 })
    .toBuffer();

  fs.writeFileSync(outputPath, buf);
}

// ─── Sharp Tier 3: Style / Colour Themes ─────────────────────────────────────
// Without AI these are colour-grade filters, not generative transforms.
// Anime gets a real edge-detection pass for a cell-shaded look.
// All others apply bold tint/saturation/contrast to be clearly distinct.
// Uses .toBuffer() throughout so input === output is safe.

async function sharpStyle(
  inputPath: string,
  outputPath: string,
  style: StylePreset,
): Promise<void> {
  // Anime: build a separate edge map and composite it for genuine cell-shading
  if (style === 'anime') {
    const edgeBuf = await sharp(inputPath)
      .greyscale()
      // Laplacian kernel: flat areas → 0 (black), edges → high (white)
      .convolve({ width: 3, height: 3, kernel: [-1, -1, -1, -1, 8, -1, -1, -1, -1] })
      .negate()   // invert: edges become dark (outlines), flat areas stay light
      .toBuffer();

    const buf = await sharp(inputPath)
      .normalize()
      .modulate({ saturation: 2.5, brightness: 1.08 })
      // multiply blend: white (flat) areas unchanged, dark (edge) areas → black outlines
      .composite([{ input: edgeBuf, blend: 'multiply' }])
      .jpeg({ quality: 94 })
      .toBuffer();

    fs.writeFileSync(outputPath, buf);
    return;
  }

  let pipeline = sharp(inputPath);

  switch (style) {
    case 'professional':
      pipeline = pipeline
        .normalize()
        .modulate({ saturation: 0.72, brightness: 1.06 })
        .sharpen({ sigma: 1.1, m1: 0.9, m2: 0.2 })
        .tint({ r: 205, g: 220, b: 248 });
      break;

    case 'casual':
      pipeline = pipeline
        .modulate({ saturation: 1.6, brightness: 1.16 })
        .tint({ r: 255, g: 240, b: 198 })
        .sharpen({ sigma: 0.6 });
      break;

    case 'fantasy':
      pipeline = pipeline
        .normalize()
        .modulate({ saturation: 2.0, brightness: 0.90 })
        .tint({ r: 170, g: 150, b: 255 });
      break;

    case 'cyberpunk':
      pipeline = pipeline
        .modulate({ saturation: 2.5, brightness: 0.78 })
        .tint({ r: 55, g: 185, b: 255 })
        .sharpen({ sigma: 1.5, m1: 1.0, m2: 0.2 });
      break;

    case 'watercolor':
      pipeline = pipeline
        .modulate({ saturation: 0.42, brightness: 1.30 })
        .blur(1.6)
        .gamma(0.85)
        .tint({ r: 250, g: 246, b: 255 });
      break;

    case 'oil-painting':
      pipeline = pipeline
        .modulate({ saturation: 1.5, brightness: 0.89 })
        .blur(0.9)
        .tint({ r: 255, g: 208, b: 138 })
        .sharpen({ sigma: 0.7, m1: 0.5, m2: 0.15 });
      break;
  }

  const buf = await pipeline.jpeg({ quality: 94 }).toBuffer();
  fs.writeFileSync(outputPath, buf);
}

// ─── Processing mode ──────────────────────────────────────────────────────────

export function getProcessingMode(): 'replicate' | 'huggingface' | 'local' | 'sharp' {
  if (config.replicateApiToken) return 'replicate';
  if (config.hfApiToken) return 'huggingface';
  if (config.rembgApiUrl || config.gfpganApiUrl || config.stableDiffusionUrl) return 'local';
  return 'sharp';
}
