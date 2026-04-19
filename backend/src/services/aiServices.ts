import fs from 'fs';
import axios from 'axios';
import FormData from 'form-data';
import sharp from 'sharp';
import Replicate from 'replicate';
import { config } from '../config';
import { StylePreset } from '../types';

// ─── Cloud API helpers ────────────────────────────────────────────────────────

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
        responseType: 'arraybuffer', timeout: ms, validateStatus: () => true,
      });
    let res = await post(30_000);
    if (res.status === 503) { await new Promise((r) => setTimeout(r, 20_000)); res = await post(90_000); }
    return res.status === 200 ? Buffer.from(res.data as ArrayBuffer) : null;
  } catch { return null; }
}

async function hfImg2Img(imageBuffer: Buffer, prompt: string, negativePrompt: string): Promise<Buffer | null> {
  if (!config.hfApiToken) return null;
  try {
    const post = (ms: number) =>
      axios.post(
        'https://api-inference.huggingface.co/models/timbrooks/instruct-pix2pix',
        { inputs: imageBuffer.toString('base64'), parameters: { prompt, negative_prompt: negativePrompt, num_inference_steps: 20, image_guidance_scale: 1.5, guidance_scale: 7 } },
        { headers: { Authorization: `Bearer ${config.hfApiToken}`, 'Content-Type': 'application/json' }, responseType: 'arraybuffer', timeout: ms, validateStatus: () => true },
      );
    let res = await post(45_000);
    if (res.status === 503) { await new Promise((r) => setTimeout(r, 25_000)); res = await post(90_000); }
    return res.status === 200 ? Buffer.from(res.data as ArrayBuffer) : null;
  } catch { return null; }
}

// ─── Core image effects (raw-pixel where needed for precision) ────────────────

/**
 * Cinema split-toning: maps shadow pixels → shadowColor, highlight pixels → highlightColor
 * based on per-pixel luminosity. Produces genuine two-colour grades, not flat tints.
 */
async function splitTone(
  src: Buffer,
  shadows: { r: number; g: number; b: number },
  highlights: { r: number; g: number; b: number },
  strength: number,
): Promise<Buffer> {
  const { data, info } = await sharp(src).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const ch = info.channels;
  for (let i = 0; i < data.length; i += ch) {
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
    .jpeg({ quality: 95 }).toBuffer();
}

/**
 * Glow / luminous bloom via screen-blend.
 * Brightens the source → blurs heavily → screen-blends back at `strength`.
 * Screen formula: result = 1 − (1−A)(1−B) — highlights bloom outward, shadows stay dark.
 * strength 0.35 = subtle dream glow, 0.60 = vivid neon bloom.
 */
async function addGlow(src: Buffer, radius: number, strength: number): Promise<Buffer> {
  const { data: srcData, info } = await sharp(src).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { data: glowData } = await sharp(src)
    .modulate({ brightness: 1.55 })
    .blur(radius)
    .removeAlpha()
    .resize(info.width, info.height)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const ch = info.channels;
  for (let i = 0; i < srcData.length; i += ch) {
    for (let c = 0; c < 3; c++) {
      const s = srcData[i + c] / 255;
      const g = glowData[i + c] / 255;
      const screened = 1 - (1 - s) * (1 - g);
      srcData[i + c] = Math.min(255, Math.round((s + (screened - s) * strength) * 255));
    }
  }
  return sharp(srcData, { raw: { width: info.width, height: info.height, channels: ch } })
    .jpeg({ quality: 95 }).toBuffer();
}

/**
 * Luminance film grain — same noise value applied across R,G,B for natural look.
 * intensity 8 = subtle photographic texture, 22 = heavy night-scene grain.
 * Applied last in pipeline so JPEG compression doesn't destroy the texture.
 */
async function addGrain(src: Buffer, intensity: number): Promise<Buffer> {
  const { data, info } = await sharp(src).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const ch = info.channels;
  for (let i = 0; i < data.length; i += ch) {
    const noise = (Math.random() - 0.5) * 2 * intensity;
    for (let c = 0; c < 3; c++) {
      data[i + c] = Math.min(255, Math.max(0, Math.round(data[i + c] + noise)));
    }
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: ch } })
    .jpeg({ quality: 95 }).toBuffer();
}

/**
 * Portrait smoothing via frequency separation approximation.
 * blur(r) removes skin-texture noise → sharpen(high m1) brings back only strong edges
 * (eyes, glasses, hair outlines). Net result: smooth skin, crisp features.
 */
async function portraitSmooth(src: Buffer): Promise<Buffer> {
  return sharp(src)
    .blur(2.2)
    .sharpen({ sigma: 2.6, m1: 2.2, m2: 0.5 })
    .toBuffer();
}

/**
 * SVG radial vignette composited as 'over' — darkens portrait edges.
 * cx 50% / cy 42% centres the bright zone on the face, not the image centre.
 */
async function addVignette(src: Buffer, strength: number): Promise<Buffer> {
  const { width: w, height: h } = await sharp(src).metadata();
  const svg = Buffer.from(
    `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="v" cx="50%" cy="42%" r="60%">
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
    const result = await hfInference('briaai/RMBG-1.4', fs.readFileSync(inputPath));
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
    const result = await hfInference('ai-forever/Real-ESRGAN', fs.readFileSync(inputPath));
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
    prompt: 'professional corporate headshot, soft studio lighting, neutral background, crisp sharp focus, 4k portrait photography',
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

export async function applyStyle(inputPath: string, outputPath: string, style: StylePreset, customPrompt?: string): Promise<void> {
  if (config.replicateApiToken) {
    const buf = await toResizedBuffer(inputPath, 768);
    const preset = STYLE_PROMPTS[style];
    const output = await getReplicate().run(
      'stability-ai/stable-diffusion-img2img:15a3689ee13b0d2616e98820eca31d4af4a36109d7db46580543f4f2fce8e024',
      { input: { image: toDataUri(buf), prompt: customPrompt ?? preset.prompt, negative_prompt: preset.negative, prompt_strength: style === 'professional' ? 0.45 : 0.65, num_inference_steps: 30, guidance_scale: 8 } },
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
    const preset = STYLE_PROMPTS[style];
    const res = await axios.post<{ images: string[] }>(
      `${config.stableDiffusionUrl}/sdapi/v1/img2img`,
      { init_images: [fs.readFileSync(inputPath).toString('base64')], prompt: customPrompt ?? preset.prompt, negative_prompt: preset.negative, denoising_strength: style === 'professional' ? 0.45 : 0.65, steps: 30, cfg_scale: 8, width: 512, height: 512 },
    );
    fs.writeFileSync(outputPath, Buffer.from(res.data.images[0], 'base64'));
    return;
  }
  await sharpStyle(inputPath, outputPath, style);
}

// ─── Sharp enhance (face enhance fallback) ────────────────────────────────────

async function sharpEnhance(inputPath: string, outputPath: string): Promise<void> {
  const { width: w = 800, height: h = 1000 } = await sharp(inputPath).metadata();
  const scale = Math.min(1.5, 2048 / Math.max(w, h));
  let buf = await sharp(inputPath)
    .resize(Math.round(w * scale), Math.round(h * scale), { kernel: sharp.kernel.lanczos3, withoutEnlargement: false })
    .normalize()
    .toBuffer();
  buf = await portraitSmooth(buf);
  buf = await sharp(buf).sharpen({ sigma: 1.4, m1: 1.0, m2: 0.1 }).modulate({ saturation: 1.2, brightness: 1.03 }).jpeg({ quality: 97 }).toBuffer();
  fs.writeFileSync(outputPath, buf);
}

// ─── Sharp style engine ───────────────────────────────────────────────────────
// Full pipeline for each of the 4 styles using real photographic effects.
// Order matters: tone → colour grade → atmosphere (glow/vignette) → grain last.

async function sharpStyle(inputPath: string, outputPath: string, style: StylePreset): Promise<void> {
  // ── Normalise + upscale to social-media quality (≥1200px on longest edge) ──
  const { width: origW = 600, height: origH = 800 } = await sharp(inputPath).metadata();
  const maxDim = Math.max(origW, origH);
  const scale = maxDim < 1200 ? Math.min(2.5, 1400 / maxDim) : 1.0;
  const W = Math.round(origW * scale);
  const H = Math.round(origH * scale);

  let buf: Buffer = await sharp(inputPath)
    .resize(W, H, { kernel: sharp.kernel.lanczos3, withoutEnlargement: false })
    .normalize()
    .toBuffer();

  // ════════════════════════════════════════════════════════════════════════════
  //  PROFESSIONAL
  //  Target: clean LinkedIn-ready studio headshot.
  //  Portrait smooth preserves skin but keeps glasses/hair sharp.
  //  Subtle split-tone lifts it above a plain photo without looking processed.
  // ════════════════════════════════════════════════════════════════════════════
  if (style === 'professional') {
    // 1. Portrait smooth: remove skin texture, keep edge detail
    buf = await portraitSmooth(buf);

    // 2. Slight desaturate + brightness lift for clean neutral look
    buf = await sharp(buf)
      .modulate({ saturation: 0.82, brightness: 1.07 })
      .toBuffer();

    // 3. Split-tone: cool-grey studio shadows, warm ivory highlights (preserves skin)
    buf = await splitTone(buf,
      { r: 175, g: 192, b: 220 },   // cool steel-blue shadow fill
      { r: 255, g: 250, b: 236 },   // warm ivory highlight (skin-safe)
      0.24,
    );

    // 4. Crisp final sharpen — eyes and glasses become razor sharp
    buf = await sharp(buf)
      .sharpen({ sigma: 1.8, m1: 1.6, m2: 0.4 })
      .jpeg({ quality: 97 })
      .toBuffer();

    // 5. Subtle grain (8) — makes it feel like a real photograph, not digital
    buf = await addGrain(buf, 8);
    fs.writeFileSync(outputPath, buf);
    return;
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  FANTASY
  //  Target: mystical high-fantasy portrait — deep violet shadows, golden glow.
  //  Glow makes the bright face area look like it has an ethereal aura.
  // ════════════════════════════════════════════════════════════════════════════
  if (style === 'fantasy') {
    // 1. Boost saturation + darken for dramatic atmosphere
    buf = await sharp(buf)
      .modulate({ saturation: 2.0, brightness: 0.88 })
      .gamma(1.3)          // push shadows into deep purple territory
      .toBuffer();

    // 2. Strong split-tone: violet-purple shadows, warm gold highlights
    buf = await splitTone(buf,
      { r: 62, g: 22, b: 168 },     // deep mystical violet in shadows
      { r: 255, g: 212, b: 88 },    // warm alchemical gold on highlights
      0.50,
    );

    // 3. Glow — blurs the brightest areas and screen-blends them back
    //    Creates a luminous aura around the face and bright edges
    buf = await addGlow(buf, 24, 0.38);

    // 4. Gentle sharpen to recover fine detail after glow
    buf = await sharp(buf).sharpen({ sigma: 0.9, m1: 0.5, m2: 0.1 }).toBuffer();

    // 5. Vignette — deep edges pull focus to the face
    buf = await addVignette(buf, 0.62);

    // 6. Atmospheric grain — feels like painted portrait
    buf = await addGrain(buf, 13);
    fs.writeFileSync(outputPath, buf);
    return;
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  CYBERPUNK
  //  Target: neon-lit night portrait.
  //  Teal/orange is the Hollywood cinematic grade pushed to neon extremes.
  //  The glow is the centrepiece — makes glasses, skin highlights, and edges
  //  look like they're lit by actual neon signs.
  // ════════════════════════════════════════════════════════════════════════════
  if (style === 'cyberpunk') {
    // 1. Desaturate natural colours then re-saturate after toning (prevents mud)
    buf = await sharp(buf)
      .modulate({ saturation: 1.85, brightness: 0.80 })
      .gamma(1.65)         // crush blacks hard for high-contrast neon feel
      .toBuffer();

    // 2. Teal+orange split-tone (the definitive cyberpunk cinema grade)
    buf = await splitTone(buf,
      { r: 0, g: 145, b: 172 },     // saturated teal/cyan in shadows
      { r: 255, g: 145, b: 25 },    // vivid neon orange on highlights
      0.56,
    );

    // 3. Neon glow — the critical effect for cyberpunk
    //    High strength (0.62) + tight radius (18) = concentrated neon bleed
    buf = await addGlow(buf, 18, 0.62);

    // 4. Hard sharpen — neon portraits look over-sharpened intentionally
    buf = await sharp(buf)
      .sharpen({ sigma: 2.0, m1: 1.8, m2: 0.4 })
      .toBuffer();

    // 5. Heavy vignette — mimics narrow-aperture night photography
    buf = await addVignette(buf, 0.76);

    // 6. Heavy grain (22) — authentic night-scene high-ISO noise
    buf = await addGrain(buf, 22);
    fs.writeFileSync(outputPath, buf);
    return;
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  ANIME
  //  Target: hand-drawn cell-shaded portrait.
  //  Bilateral-smooth approximation gives flat anime colour areas.
  //  Binary Laplacian outlines via multiply blend = ink-on-paper look.
  // ════════════════════════════════════════════════════════════════════════════
  if (style === 'anime') {
    // 1. Smooth the image to create flat-colour anime areas (bilateral approx.)
    const animeBase = await sharp(buf)
      .blur(1.8)
      .modulate({ saturation: 3.2, brightness: 1.10 })
      .toBuffer();

    // 2. Laplacian edge map from the normalised base (not blurred — cleaner edges)
    //    normalize → amplify → threshold(50) = binary clear edges only
    //    negate → edges are black (outlines), flat areas white (pass-through)
    const edgeBuf = await sharp(buf)
      .greyscale()
      .convolve({ width: 3, height: 3, kernel: [-1, -1, -1, -1, 8, -1, -1, -1, -1] })
      .normalize()
      .threshold(50)
      .negate()
      .resize(W, H)
      .toColourspace('srgb')
      .toBuffer();

    // 3. Multiply composite: black outlines absorb colour → ink outlines appear
    buf = await sharp(animeBase)
      .composite([{ input: edgeBuf, blend: 'multiply' }])
      .sharpen({ sigma: 0.5 })
      .jpeg({ quality: 95 })
      .toBuffer();

    fs.writeFileSync(outputPath, buf);
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
