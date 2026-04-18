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
    if (res.status === 503) { await new Promise((r) => setTimeout(r, 20_000)); res = await post(90_000); }
    return res.status === 200 ? Buffer.from(res.data as ArrayBuffer) : null;
  } catch { return null; }
}

async function hfImg2Img(imageBuffer: Buffer, prompt: string, negativePrompt: string): Promise<Buffer | null> {
  if (!config.hfApiToken) return null;
  try {
    const model = 'timbrooks/instruct-pix2pix';
    const post = (ms: number) =>
      axios.post(
        `https://api-inference.huggingface.co/models/${model}`,
        {
          inputs: imageBuffer.toString('base64'),
          parameters: { prompt, negative_prompt: negativePrompt, num_inference_steps: 20, image_guidance_scale: 1.5, guidance_scale: 7 },
        },
        {
          headers: { Authorization: `Bearer ${config.hfApiToken}`, 'Content-Type': 'application/json' },
          responseType: 'arraybuffer',
          timeout: ms,
          validateStatus: () => true,
        },
      );
    let res = await post(45_000);
    if (res.status === 503) { await new Promise((r) => setTimeout(r, 25_000)); res = await post(90_000); }
    return res.status === 200 ? Buffer.from(res.data as ArrayBuffer) : null;
  } catch { return null; }
}

// ─── Cinema-grade luminosity split-toning ─────────────────────────────────────
// Each pixel is mapped toward shadowColor (dark pixels) or highlightColor (bright pixels)
// based on its luminosity. This produces genuine two-colour cinematic grades, not flat tints.
async function splitTone(
  src: Buffer,
  shadows: { r: number; g: number; b: number },
  highlights: { r: number; g: number; b: number },
  strength: number,
): Promise<Buffer> {
  const { data, info } = await sharp(src).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const ch = info.channels;

  for (let i = 0; i < data.length; i += ch) {
    // luminosity 0-1: 0 = pure shadow, 1 = pure highlight
    const t = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
    const grade = [
      shadows.r + (highlights.r - shadows.r) * t,
      shadows.g + (highlights.g - shadows.g) * t,
      shadows.b + (highlights.b - shadows.b) * t,
    ];
    for (let c = 0; c < 3; c++) {
      data[i + c] = Math.min(255, Math.max(0, Math.round(data[i + c] * (1 - strength) + grade[c] * strength)));
    }
  }

  return sharp(data, { raw: { width: info.width, height: info.height, channels: ch } })
    .jpeg({ quality: 95 })
    .toBuffer();
}

// ─── Portrait vignette ────────────────────────────────────────────────────────
// SVG radial gradient composited as an 'over' layer — darkens the edges.
async function addVignette(src: Buffer, strength: number = 0.65): Promise<Buffer> {
  const { width: w, height: h } = await sharp(src).metadata();
  const svg = Buffer.from(
    `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="v" cx="50%" cy="42%" r="62%">
          <stop offset="0%" stop-color="black" stop-opacity="0"/>
          <stop offset="100%" stop-color="black" stop-opacity="${strength}"/>
        </radialGradient>
      </defs>
      <rect width="${w}" height="${h}" fill="url(#v)"/>
    </svg>`,
  );
  return sharp(src).composite([{ input: svg, blend: 'over' }]).jpeg({ quality: 95 }).toBuffer();
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
    const res = await axios.post(config.rembgApiUrl, form, { headers: form.getHeaders(), responseType: 'arraybuffer' });
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
      const capped = await sharp(result).resize(2048, 2048, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 96 }).toBuffer();
      fs.writeFileSync(outputPath, capped);
      return;
    }
  }
  if (config.gfpganApiUrl) {
    const form = new FormData();
    form.append('image', fs.createReadStream(inputPath));
    const res = await axios.post(`${config.gfpganApiUrl}/restore`, form, { headers: form.getHeaders(), responseType: 'arraybuffer' });
    fs.writeFileSync(outputPath, Buffer.from(res.data as ArrayBuffer));
    return;
  }
  await sharpEnhance(inputPath, outputPath);
}

// ─── Style Transfer ───────────────────────────────────────────────────────────

const STYLE_PROMPTS: Record<StylePreset, { prompt: string; negative: string; instruction: string }> = {
  professional: {
    prompt: 'professional corporate headshot, soft studio lighting, neutral background, crisp sharp focus, 4k business portrait photography',
    negative: 'casual, cartoon, anime, blurry, distorted, bad lighting',
    instruction: 'convert to a professional corporate headshot with soft studio lighting and neutral grey background',
  },
  fantasy: {
    prompt: 'epic high fantasy portrait, mystical purple and gold lighting, magical aura, ethereal glow, highly detailed digital art',
    negative: 'modern, office, realistic plain background, blurry',
    instruction: 'transform into an epic fantasy portrait with magical purple and golden lighting and ethereal mystical atmosphere',
  },
  cyberpunk: {
    prompt: 'cyberpunk neon portrait, futuristic city at night, teal and orange neon lights, dark atmosphere, cinematic, highly detailed',
    negative: 'natural daylight, medieval, warm plain background',
    instruction: 'transform into a cyberpunk neon portrait with teal and orange neon lights in a dark futuristic city',
  },
  anime: {
    prompt: 'anime portrait, studio ghibli style, cell-shaded, vibrant colors, clean lines, expressive eyes',
    negative: 'photorealistic, 3d render, blurry',
    instruction: 'convert to anime art style with cell-shading, vibrant colors, and clean bold outlines',
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
          prompt_strength: style === 'professional' ? 0.45 : 0.65,
          num_inference_steps: 30,
          guidance_scale: 8,
        },
      },
    ) as unknown as string[];
    await downloadToFile(output[0], outputPath);
    return;
  }

  if (config.hfApiToken) {
    const buf = await toResizedBuffer(inputPath, 512);
    const preset = STYLE_PROMPTS[style];
    const result = await hfImg2Img(buf, preset.instruction, preset.negative);
    if (result) {
      const resized = await sharp(result).resize(1024, 1024, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 95 }).toBuffer();
      fs.writeFileSync(outputPath, resized);
      return;
    }
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
        denoising_strength: style === 'professional' ? 0.45 : 0.65,
        steps: 30, cfg_scale: 8, width: 512, height: 512,
      },
    );
    fs.writeFileSync(outputPath, Buffer.from(res.data.images[0], 'base64'));
    return;
  }

  await sharpStyle(inputPath, outputPath, style);
}

// ─── Sharp Tier 3: Face Enhance ───────────────────────────────────────────────

async function sharpEnhance(inputPath: string, outputPath: string): Promise<void> {
  const { width: w = 800, height: h = 1000 } = await sharp(inputPath).metadata();
  const scale = Math.min(1.5, 2048 / Math.max(w, h));
  const buf = await sharp(inputPath)
    .resize(Math.round(w * scale), Math.round(h * scale), { kernel: sharp.kernel.lanczos3, withoutEnlargement: false })
    .normalize()
    .sharpen({ sigma: 1.3, m1: 0.9, m2: 0.1 })
    .modulate({ saturation: 1.28, brightness: 1.03 })
    .jpeg({ quality: 96 })
    .toBuffer();
  fs.writeFileSync(outputPath, buf);
}

// ─── Sharp Tier 3: Style colour grades ───────────────────────────────────────
// Uses cinema-grade luminosity split-toning (not flat tints) for genuinely distinct results.
// Anime gets bilaterial-smooth + binary Laplacian cell-shading outlines.
// Fantasy/Cyberpunk get split-tone + gamma + vignette for dramatic atmosphere.

async function sharpStyle(inputPath: string, outputPath: string, style: StylePreset): Promise<void> {
  // Upscale passport/small images so processing has more pixels to work with
  const { width: origW = 600, height: origH = 800 } = await sharp(inputPath).metadata();
  const maxDim = Math.max(origW, origH);
  const scale = maxDim < 900 ? Math.min(2.0, 1200 / maxDim) : 1.0;
  const W = Math.round(origW * scale);
  const H = Math.round(origH * scale);

  // Normalised, upscaled base — common starting point for all styles
  let base: Buffer = await sharp(inputPath)
    .resize(W, H, { kernel: sharp.kernel.lanczos3, withoutEnlargement: false })
    .normalize()
    .toBuffer();

  // ── Professional ────────────────────────────────────────────────────────────
  // Goal: clean, crisp, neutral studio headshot.
  // Slight warmth in highlights preserves skin tones; cool shadows = studio fill.
  if (style === 'professional') {
    base = await sharp(base)
      .modulate({ saturation: 0.80, brightness: 1.08 })
      .sharpen({ sigma: 2.0, m1: 1.6, m2: 0.4 })
      .toBuffer();

    // Split tone: cool-grey shadows, ivory warm highlights
    base = await splitTone(
      base,
      { r: 178, g: 195, b: 222 },   // cool studio-fill blue-grey in shadows
      { r: 255, g: 249, b: 235 },   // warm ivory skin-tone highlights
      0.26,
    );
    fs.writeFileSync(outputPath, base);
    return;
  }

  // ── Fantasy ─────────────────────────────────────────────────────────────────
  // Goal: mystical, magical, high-fantasy portrait.
  // Deep violet shadows, warm golden highlights, vignette for atmospheric depth.
  if (style === 'fantasy') {
    base = await sharp(base)
      .modulate({ saturation: 2.1, brightness: 0.88 })
      .gamma(1.35)   // push shadows darker for atmosphere
      .toBuffer();

    // Strong split tone: deep violet-purple shadows, warm gold highlights
    base = await splitTone(
      base,
      { r: 65, g: 25, b: 165 },     // deep mystic purple/violet in shadows
      { r: 255, g: 210, b: 85 },    // warm golden glow on highlights
      0.50,
    );
    base = await sharp(base).sharpen({ sigma: 0.9, m1: 0.5, m2: 0.1 }).toBuffer();
    base = await addVignette(base, 0.62);
    fs.writeFileSync(outputPath, base);
    return;
  }

  // ── Cyberpunk ────────────────────────────────────────────────────────────────
  // Goal: neon-lit futuristic night portrait.
  // Teal/cyan shadows, orange highlights — the classic Hollywood "orange & teal" grade
  // pushed to neon extremes with crushed blacks.
  if (style === 'cyberpunk') {
    base = await sharp(base)
      .modulate({ saturation: 2.0, brightness: 0.82 })
      .gamma(1.65)   // hard-crush blacks for neon contrast
      .toBuffer();

    // Teal + orange cinematic split tone (pushed to neon saturation)
    base = await splitTone(
      base,
      { r: 0, g: 148, b: 175 },     // saturated teal/cyan neon shadows
      { r: 255, g: 148, b: 28 },    // vivid orange neon highlights
      0.55,
    );
    base = await sharp(base).sharpen({ sigma: 2.0, m1: 1.8, m2: 0.4 }).toBuffer();
    base = await addVignette(base, 0.75);
    fs.writeFileSync(outputPath, base);
    return;
  }

  // ── Anime ────────────────────────────────────────────────────────────────────
  // Goal: hand-drawn cell-shaded anime portrait.
  // 1. Smooth the image to get flat colour areas (bilateral-filter approximation).
  // 2. Boost saturation to anime-vivid levels.
  // 3. Extract binary Laplacian edges → black outlines on white via threshold + negate.
  // 4. Multiply-blend outlines over the vivid base.
  if (style === 'anime') {
    // Smoothed + vivid base (approximates flat anime colours)
    const animeBase = await sharp(base)
      .blur(1.8)
      .modulate({ saturation: 3.4, brightness: 1.12 })
      .toBuffer();

    // Laplacian edge map → binary → negate (edges = black, flat = white) → sRGB for composite
    const edgeBuf = await sharp(base)
      .greyscale()
      .convolve({ width: 3, height: 3, kernel: [-1, -1, -1, -1, 8, -1, -1, -1, -1] })
      .normalize()          // amplify the edge signal
      .threshold(50)        // binary: clear edges only, suppress noise
      .negate()             // invert: edges=black (outlines), flat=white (pass-through)
      .resize(W, H)
      .toColourspace('srgb') // ensure 3-channel for multiply composite
      .toBuffer();

    // Multiply blend: black outlines absorb colour → creates cartoon outlines
    const composed = await sharp(animeBase)
      .composite([{ input: edgeBuf, blend: 'multiply' }])
      .sharpen({ sigma: 0.4 })
      .jpeg({ quality: 95 })
      .toBuffer();

    fs.writeFileSync(outputPath, composed);
    return;
  }
}

// ─── Background Fill ──────────────────────────────────────────────────────────

export async function applyBackground(inputPath: string, outputPath: string, hexColor: string): Promise<void> {
  const hex = hexColor.replace('#', '');
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const buf = await sharp(inputPath).flatten({ background: { r, g, b } }).jpeg({ quality: 95 }).toBuffer();
  fs.writeFileSync(outputPath, buf);
}

// ─── Processing mode ──────────────────────────────────────────────────────────

export function getProcessingMode(): 'replicate' | 'huggingface' | 'local' | 'sharp' {
  if (config.replicateApiToken) return 'replicate';
  if (config.hfApiToken) return 'huggingface';
  if (config.rembgApiUrl || config.gfpganApiUrl || config.stableDiffusionUrl) return 'local';
  return 'sharp';
}
