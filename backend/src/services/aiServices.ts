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

// HuggingFace Inference API for image-to-image (blob → blob).
// Used for background removal and face enhance.
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

// HuggingFace InstructPix2Pix — image + text prompt → transformed image.
// Sends base64 image + prompt as JSON; falls back on any error.
async function hfImg2Img(
  imageBuffer: Buffer,
  prompt: string,
  negativePrompt: string,
): Promise<Buffer | null> {
  if (!config.hfApiToken) return null;
  try {
    const model = 'timbrooks/instruct-pix2pix';
    const b64 = imageBuffer.toString('base64');
    const post = (ms: number) =>
      axios.post(
        `https://api-inference.huggingface.co/models/${model}`,
        {
          inputs: b64,
          parameters: {
            prompt,
            negative_prompt: negativePrompt,
            num_inference_steps: 20,
            image_guidance_scale: 1.5,
            guidance_scale: 7,
          },
        },
        {
          headers: {
            Authorization: `Bearer ${config.hfApiToken}`,
            'Content-Type': 'application/json',
          },
          responseType: 'arraybuffer',
          timeout: ms,
          validateStatus: () => true,
        },
      );

    let res = await post(45_000);
    if (res.status === 503) {
      await new Promise((r) => setTimeout(r, 25_000));
      res = await post(90_000);
    }
    return res.status === 200 ? Buffer.from(res.data as ArrayBuffer) : null;
  } catch {
    return null;
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

  if (config.hfApiToken) {
    const imageBuffer = fs.readFileSync(inputPath);
    const result = await hfInference('briaai/RMBG-1.4', imageBuffer);
    if (result) { fs.writeFileSync(outputPath, result); return; }
  }

  if (config.rembgApiUrl) {
    const form = new FormData();
    form.append('file', fs.createReadStream(inputPath));
    const res = await axios.post(config.rembgApiUrl, form, {
      headers: form.getHeaders(), responseType: 'arraybuffer',
    });
    fs.writeFileSync(outputPath, Buffer.from(res.data as ArrayBuffer));
    return;
  }

  await sharpEnhance(inputPath, outputPath);
}

// ─── Face Enhancement ─────────────────────────────────────────────────────────

export async function enhanceFace(inputPath: string, outputPath: string): Promise<void> {
  if (config.replicateApiToken) {
    const buf = await toResizedBuffer(inputPath);
    const output = await getReplicate().run(
      'tencentarc/gfpgan:9283608cc6b7be6b65a8e44983db012355fde4132009bf99d976b2f0896856a3',
      { input: { img: toDataUri(buf), version: 'v1.4', scale: 2 } },
    ) as unknown as string;
    await downloadToFile(output, outputPath);
    return;
  }

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

const STYLE_PROMPTS: Record<StylePreset, { prompt: string; negative: string; instruction: string }> = {
  professional: {
    prompt: 'professional corporate headshot, soft studio lighting, neutral background, crisp sharp focus, 4k business portrait photography',
    negative: 'casual, cartoon, anime, blurry, distorted, bad lighting, shadows on face',
    instruction: 'convert to a professional corporate headshot with soft studio lighting and neutral grey background',
  },
  fantasy: {
    prompt: 'epic high fantasy portrait, mystical purple and gold lighting, magical aura, intricate ethereal details, highly detailed digital art, fantasy character art',
    negative: 'modern, office, photorealistic plain background, low quality, blurry',
    instruction: 'transform into an epic fantasy portrait with magical purple and golden lighting and ethereal mystical atmosphere',
  },
  cyberpunk: {
    prompt: 'cyberpunk neon portrait, futuristic city at night, teal and orange neon lights, rain reflections, dark atmosphere, cinematic, highly detailed',
    negative: 'natural daylight, medieval, warm tones, clean bright background, low contrast',
    instruction: 'transform into a cyberpunk neon portrait with teal and orange neon lights in a dark futuristic city',
  },
  anime: {
    prompt: 'anime portrait, studio ghibli art style, cell-shaded, vibrant colors, clean crisp lines, expressive large eyes, soft pastel highlights',
    negative: 'photorealistic, western cartoon, 3d render, blurry, low quality',
    instruction: 'convert to anime art style with cell-shading, vibrant colors, and clean bold outlines like studio ghibli',
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
          prompt_strength: style === 'professional' ? 0.45 : 0.65,
          num_inference_steps: 30,
          guidance_scale: 8,
        },
      },
    ) as unknown as string[];
    await downloadToFile(output[0], outputPath);
    return;
  }

  // Tier 1.5 — HuggingFace InstructPix2Pix img2img
  if (config.hfApiToken) {
    const buf = await toResizedBuffer(inputPath, 512);
    const preset = STYLE_PROMPTS[style];
    const result = await hfImg2Img(buf, preset.instruction, preset.negative);
    if (result) {
      const resized = await sharp(result)
        .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 95 })
        .toBuffer();
      fs.writeFileSync(outputPath, resized);
      return;
    }
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
        denoising_strength: style === 'professional' ? 0.45 : 0.65,
        steps: 30, cfg_scale: 8, width: 512, height: 512,
      },
    );
    fs.writeFileSync(outputPath, Buffer.from(res.data.images[0], 'base64'));
    return;
  }

  // Tier 3 — Sharp colour-grade (no AI available)
  await sharpStyle(inputPath, outputPath, style);
}

// ─── Sharp Tier 3: Face Enhance ───────────────────────────────────────────────

async function sharpEnhance(inputPath: string, outputPath: string): Promise<void> {
  const { width: w = 800, height: h = 1000 } = await sharp(inputPath).metadata();
  const scale = Math.min(1.5, 2048 / Math.max(w, h));

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

// ─── Sharp Tier 3: Style colour grades ───────────────────────────────────────
// These are colour-grade filters — bold and visually distinct without generative AI.
// Each style targets a dramatically different colour palette and contrast profile.

async function sharpStyle(
  inputPath: string,
  outputPath: string,
  style: StylePreset,
): Promise<void> {

  if (style === 'anime') {
    // Cell-shaded look: Laplacian edge detection → black outlines on vivid image
    const edgeBuf = await sharp(inputPath)
      .greyscale()
      .convolve({ width: 3, height: 3, kernel: [-1, -1, -1, -1, 8, -1, -1, -1, -1] })
      .normalize()   // amplify edge contrast to max
      .negate()      // invert → edges become dark outlines, flat areas white
      .toBuffer();

    const buf = await sharp(inputPath)
      .normalize()
      .modulate({ saturation: 2.8, brightness: 1.06 })
      .sharpen({ sigma: 0.5 })
      .composite([{ input: edgeBuf, blend: 'multiply' }])
      .jpeg({ quality: 95 })
      .toBuffer();

    fs.writeFileSync(outputPath, buf);
    return;
  }

  if (style === 'cyberpunk') {
    // Teal+orange dual-tone neon look with crushed blacks
    const buf = await sharp(inputPath)
      .normalize()
      .modulate({ saturation: 2.2, brightness: 0.82 })
      .tint({ r: 40, g: 180, b: 255 })        // teal-cyan neon cast
      .sharpen({ sigma: 1.8, m1: 1.2, m2: 0.3 })
      .gamma(1.4)                               // crush the shadows
      .jpeg({ quality: 94 })
      .toBuffer();

    fs.writeFileSync(outputPath, buf);
    return;
  }

  if (style === 'fantasy') {
    // Deep violet-gold, high contrast, ethereal atmosphere
    const buf = await sharp(inputPath)
      .normalize()
      .modulate({ saturation: 2.0, brightness: 0.88 })
      .tint({ r: 160, g: 130, b: 255 })        // mystical purple cast
      .sharpen({ sigma: 0.9, m1: 0.5, m2: 0.1 })
      .gamma(1.2)
      .jpeg({ quality: 94 })
      .toBuffer();

    fs.writeFileSync(outputPath, buf);
    return;
  }

  if (style === 'professional') {
    // Cool studio tone — desaturated, sharp, neutral blue-grey cast
    const buf = await sharp(inputPath)
      .normalize()
      .modulate({ saturation: 0.62, brightness: 1.06 })
      .sharpen({ sigma: 1.5, m1: 1.1, m2: 0.2 })
      .tint({ r: 210, g: 222, b: 255 })        // subtle cool studio blue
      .jpeg({ quality: 96 })
      .toBuffer();

    fs.writeFileSync(outputPath, buf);
    return;
  }
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

  const buf = await sharp(inputPath)
    .flatten({ background: { r, g, b } })
    .jpeg({ quality: 95 })
    .toBuffer();
  fs.writeFileSync(outputPath, buf);
}

// ─── Processing mode ──────────────────────────────────────────────────────────

export function getProcessingMode(): 'replicate' | 'huggingface' | 'local' | 'sharp' {
  if (config.replicateApiToken) return 'replicate';
  if (config.hfApiToken) return 'huggingface';
  if (config.rembgApiUrl || config.gfpganApiUrl || config.stableDiffusionUrl) return 'local';
  return 'sharp';
}
