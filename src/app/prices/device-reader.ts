/**
 * Reads receipt photos on the device with Tesseract (open-source text recognition, compiled to
 * WebAssembly). Free, private, and needs no account: nothing leaves the phone except the final,
 * checked receipt.
 *
 * The reader's files are served by this app under /ocr (see angular.json assets): the worker,
 * the engine (~4 MB) and English text data (~3 MB). The browser caches them after the first use.
 * tesseract.js itself is loaded only when a photo is read, so the rest of the app stays small.
 *
 * Before reading, each photo is prepared the way text recognition likes it (see prepare):
 * cropped to the receipt, contrast stretched, its lines of print straightened (receipts curl, and
 * phones are held at an angle), and small print enlarged.
 */
import { Frame, boxMean, frameFromStrokes, levelRows, slopeField, strokesAround, thinStrokes } from './receipt-image';

export type { Frame };

export interface ReadProgress {
  photo: number;
  photos: number;
  /** 0–100 across all photos. */
  percent: number;
  /** "Getting the reader ready" while downloading on first use, then "Reading". */
  stage: string;
}

export interface FramedPhoto {
  blob: Blob;
  /** The part of the photo with the receipt, or null to find it automatically. */
  frame: Frame | null;
}

/** Print is read best when the receipt is about this wide, in pixels. */
const TARGET_WIDTH = 1300;
/** Keeps the enlarged image within what phones handle comfortably. */
const MAX_PIXELS = 8_000_000;

/**
 * Where the receipt is in a photo: the area where thin dark strokes (print) are dense. On a busy
 * background (a patterned bedspread, a wood table) the paper itself is hard to tell apart, but
 * printed text isn't. The person can adjust the result before reading.
 */
export async function findReceipt(photo: Blob): Promise<Frame> {
  const bitmap = await createImageBitmap(photo);
  try {
    const width = Math.min(640, bitmap.width);
    const height = Math.max(1, Math.round((bitmap.height * width) / bitmap.width));
    const gray = grayPixels(bitmap, 0, 0, bitmap.width, bitmap.height, width, height);
    return frameFromStrokes(boxMean(thinStrokes(gray, width, height, 3, 35), width, height, Math.max(2, Math.round(width / 80))), width, height);
  } finally {
    bitmap.close();
  }
}

/**
 * Reads every photo twice, in two page-layout modes, and returns one text per mode (photos joined
 * top to bottom). "Single block" keeps a name and its far-right price on one line; "single column"
 * separates closely printed detail lines better. The parser combines the two (bestReading).
 */
export async function readOnDevice(photos: FramedPhoto[], onProgress: (p: ReadProgress) => void): Promise<string[]> {
  // tesseract.js is a CommonJS module: when bundled, its exports arrive under `default`.
  type Tesseract = typeof import('tesseract.js');
  const loaded = (await import('tesseract.js')) as Tesseract & { default?: Tesseract };
  const { createWorker, PSM, OEM } = loaded.default ?? loaded;
  const base = new URL('/ocr/', window.location.origin).href;
  const modes = [PSM.SINGLE_BLOCK, PSM.SINGLE_COLUMN];
  const steps = photos.length * modes.length;
  let current = 0; // the photo being read
  let step = 0; // recognitions finished, across modes and photos

  const worker = await createWorker('eng', OEM.LSTM_ONLY, {
    workerPath: `${base}worker.min.js`,
    corePath: `${base}core`,
    langPath: `${base}lang`,
    workerBlobURL: false,
    gzip: true,
    logger: (message) => {
      const reading = message.status === 'recognizing text';
      const share = reading ? message.progress : 0;
      onProgress({
        photo: current + 1,
        photos: photos.length,
        percent: Math.min(99, Math.round(((step + share) / steps) * 100)),
        stage: reading ? 'Reading' : 'Getting the reader ready',
      });
    },
  });

  try {
    const canvases: HTMLCanvasElement[] = [];
    for (const photo of photos) canvases.push(await prepare(photo.blob, photo.frame ?? (await findReceipt(photo.blob))));
    const readings: string[] = [];
    for (const mode of modes) {
      // Keep the spaces between name and price. Phone photos carry no resolution, so suggest one.
      await worker.setParameters({ tessedit_pageseg_mode: mode, preserve_interword_spaces: '1', user_defined_dpi: '300' });
      const texts: string[] = [];
      for (current = 0; current < canvases.length; current++) {
        const { data } = await worker.recognize(canvases[current]);
        texts.push(data.text);
        step++;
      }
      readings.push(texts.join('\n'));
    }
    onProgress({ photo: photos.length, photos: photos.length, percent: 100, stage: 'Reading' });
    return readings;
  } finally {
    await worker.terminate();
  }
}

/**
 * Crops to the frame, stretches the contrast between the darkest and lightest 2% (faded print,
 * dim light), straightens the lines of print strip by strip, and enlarges small print so letters
 * are about 30 pixels tall.
 */
async function prepare(photo: Blob, frame: Frame): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(photo);
  try {
    const sx = Math.round(frame.left * bitmap.width);
    const sy = Math.round(frame.top * bitmap.height);
    const sw = Math.max(1, Math.round((frame.right - frame.left) * bitmap.width));
    const sh = Math.max(1, Math.round((frame.bottom - frame.top) * bitmap.height));

    // Measure at the photo's own resolution: contrast, and the slope of the print down the receipt.
    const small = grayPixels(bitmap, sx, sy, sw, sh, sw, sh);
    const [lo, hi] = percentiles(small, 0.02, 0.98);
    const span = Math.max(hi - lo, 1);
    for (let i = 0; i < small.length; i++) small[i] = clamp(((small[i] - lo) * 255) / span);
    const slopes = slopeField(strokesAround(small, sw, sh), sw, sh);

    // Then draw it enlarged, and read each output row along the slope of the print.
    const enlarge = sw < TARGET_WIDTH * 0.67 ? Math.min(3, TARGET_WIDTH / sw) : 1;
    const scale = Math.min(enlarge, Math.sqrt(MAX_PIXELS / (sw * sh)));
    const width = Math.max(1, Math.round(sw * scale));
    const height = Math.max(1, Math.round(sh * scale));
    const big = grayPixels(bitmap, sx, sy, sw, sh, width, height);
    for (let i = 0; i < big.length; i++) big[i] = clamp(((big[i] - lo) * 255) / span);
    const level = levelRows(big, width, height, (y) => slopes[Math.min(sh - 1, Math.floor(y / scale))]);

    const out = document.createElement('canvas');
    out.width = width;
    out.height = height;
    const ctx = out.getContext('2d');
    if (!ctx) throw new Error('This browser can’t prepare the photo for reading.');
    const image = ctx.createImageData(width, height);
    const o = image.data;
    for (let i = 0, k = 0; i < level.length; i++, k += 4) {
      o[k] = o[k + 1] = o[k + 2] = level[i];
      o[k + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    return out;
  } finally {
    bitmap.close();
  }
}

/** Gray levels (0–255) of part of a bitmap, drawn at the given size with smooth scaling. */
function grayPixels(bitmap: ImageBitmap, sx: number, sy: number, sw: number, sh: number, width: number, height: number): Uint8ClampedArray {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('This browser can’t prepare the photo for reading.');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, width, height);
  const px = ctx.getImageData(0, 0, width, height).data;
  const gray = new Uint8ClampedArray(width * height);
  for (let i = 0, j = 0; i < px.length; i += 4, j++) gray[j] = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000;
  canvas.width = canvas.height = 0; // let the browser free it now
  return gray;
}

function percentiles(gray: Uint8ClampedArray, low: number, high: number): [number, number] {
  const histogram = new Uint32Array(256);
  for (const v of gray) histogram[v]++;
  let count = 0;
  let lo = 0;
  let hi = 255;
  let foundLo = false;
  for (let v = 0; v < 256; v++) {
    count += histogram[v];
    if (!foundLo && count >= gray.length * low) {
      lo = v;
      foundLo = true;
    }
    if (count >= gray.length * high) {
      hi = v;
      break;
    }
  }
  return [lo, hi];
}

function clamp(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}
