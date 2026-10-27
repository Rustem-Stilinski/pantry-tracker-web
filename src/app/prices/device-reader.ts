/**
 * Reads receipt photos on the device with Tesseract (open-source text recognition, compiled to
 * WebAssembly). Free, private, and needs no account: nothing leaves the phone except the final,
 * checked receipt.
 *
 * The reader's files are served by this app under /ocr (see angular.json assets): the worker,
 * the engine (~4 MB) and English text data (~3 MB). The browser caches them after the first use.
 * tesseract.js itself is loaded only when a photo is read, so the rest of the app stays small.
 */

export interface ReadProgress {
  photo: number;
  photos: number;
  /** 0–100 across all photos. */
  percent: number;
  /** "Getting the reader ready" while downloading on first use, then "Reading". */
  stage: string;
}

/**
 * Reads every photo twice, in two page-layout modes, and returns one text per mode (photos joined
 * top to bottom). "Single block" keeps a name and its far-right price on one line even when the
 * photo is tilted; "single column" separates closely printed detail lines better. The caller keeps
 * whichever reading adds up (bestReading in receipt-parser.ts).
 */
export async function readOnDevice(photos: Blob[], onProgress: (p: ReadProgress) => void): Promise<string[]> {
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
    for (const photo of photos) canvases.push(await prepare(photo));
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
 * Crops to the receipt and boosts contrast. Cropping matters most: with the table or counter gone,
 * Tesseract straightens a tilted receipt by itself and keeps prices on their lines. Then grayscale
 * with the contrast stretched between the darkest and lightest 2% of the paper, for faded print.
 */
async function prepare(photo: Blob): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(photo);
  const { width, height } = bitmap;
  const source = document.createElement('canvas');
  source.width = width;
  source.height = height;
  const sctx = source.getContext('2d', { willReadFrequently: true });
  if (!sctx) {
    bitmap.close();
    throw new Error('This browser can’t prepare the photo for reading.');
  }
  sctx.drawImage(bitmap, 0, 0);
  bitmap.close();

  const px = sctx.getImageData(0, 0, width, height).data;
  const gray = new Uint8ClampedArray(width * height);
  const histogram = new Uint32Array(256);
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    gray[j] = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000;
    histogram[gray[j]]++;
  }

  // The paper is the bright part: rows and columns where at least 30% of pixels are brighter than
  // halfway between the photo's dark and light ends.
  const [dark, light] = percentiles(histogram, gray.length, 0.05, 0.95);
  const threshold = (dark + light) / 2;
  const rowBright = new Uint32Array(height);
  const colBright = new Uint32Array(width);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (gray[y * width + x] > threshold) {
        rowBright[y]++;
        colBright[x]++;
      }
    }
  }
  let top = 0;
  let bottom = height - 1;
  let left = 0;
  let right = width - 1;
  while (top < bottom && rowBright[top] < width * 0.3) top++;
  while (bottom > top && rowBright[bottom] < width * 0.3) bottom--;
  while (left < right && colBright[left] < height * 0.3) left++;
  while (right > left && colBright[right] < height * 0.3) right--;
  // Keeping too little means the guess was wrong (white counter, dark receipt): use the whole photo.
  if ((bottom - top) * (right - left) < width * height * 0.15) {
    top = 0;
    bottom = height - 1;
    left = 0;
    right = width - 1;
  }

  const cw = right - left + 1;
  const ch = bottom - top + 1;
  const paper = new Uint32Array(256);
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) paper[gray[y * width + x]]++;
  }
  const [lo, hi] = percentiles(paper, cw * ch, 0.02, 0.98);
  const span = Math.max(hi - lo, 1);

  const out = document.createElement('canvas');
  out.width = cw;
  out.height = ch;
  const octx = out.getContext('2d');
  if (!octx) return source;
  const image = octx.createImageData(cw, ch);
  const o = image.data;
  for (let y = 0, k = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++, k += 4) {
      const v = Math.max(0, Math.min(255, ((gray[(y + top) * width + x + left] - lo) * 255) / span));
      o[k] = o[k + 1] = o[k + 2] = v;
      o[k + 3] = 255;
    }
  }
  octx.putImageData(image, 0, 0);
  return out;
}

function percentiles(histogram: Uint32Array, total: number, low: number, high: number): [number, number] {
  let count = 0;
  let lo = 0;
  let hi = 255;
  let foundLo = false;
  for (let v = 0; v < 256; v++) {
    count += histogram[v];
    if (!foundLo && count >= total * low) { lo = v; foundLo = true; }
    if (count >= total * high) { hi = v; break; }
  }
  return [lo, hi];
}
