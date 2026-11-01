/**
 * Reads product barcodes from the camera or a photo.
 *
 * Uses the browser's own BarcodeDetector where it has one that knows product barcodes (Chrome on Android);
 * everywhere else (iPhone and iPad Safari, Firefox, desktop) it loads the same API built on ZXing as
 * WebAssembly. That reader (~1 MB) is served by this app under /barcode, loaded only when someone scans,
 * and cached after the first time.
 */
import { PRODUCT_FORMATS } from '../core/barcode';

export interface FoundBarcode {
  /** Digits as read; the server puts them in one canonical form. */
  code: string;
  /** "ean_13", "upc_a", "ean_8" or "upc_e". */
  format: string;
}

interface Detected {
  rawValue: string;
  format: string;
}

export interface Detector {
  detect(source: ImageBitmapSource): Promise<Detected[]>;
}

interface NativeDetectorClass {
  new (options: { formats: string[] }): Detector;
  getSupportedFormats(): Promise<string[]>;
}

let loading: Promise<Detector> | null = null;

/** One detector for the page's lifetime. A failed load is forgotten so the next try starts over. */
export function barcodeDetector(): Promise<Detector> {
  loading ??= createDetector().catch((err) => {
    loading = null;
    throw err;
  });
  return loading;
}

async function createDetector(): Promise<Detector> {
  const Native = (globalThis as { BarcodeDetector?: NativeDetectorClass }).BarcodeDetector;
  if (Native) {
    try {
      const supported = await Native.getSupportedFormats();
      const formats = PRODUCT_FORMATS.filter((f) => supported.includes(f));
      if (formats.includes('ean_13') && formats.includes('upc_a')) return new Native({ formats });
    } catch {
      /* fall through to the WebAssembly reader */
    }
  }
  const { BarcodeDetector, prepareZXingModule } = await import('barcode-detector/ponyfill');
  prepareZXingModule({
    overrides: {
      locateFile: (path: string, prefix: string) =>
        path.endsWith('.wasm') ? new URL(`/barcode/${path}`, window.location.origin).href : prefix + path,
    },
  });
  return new BarcodeDetector({ formats: [...PRODUCT_FORMATS] });
}

/** The first product barcode in a detector's answer, or null. */
export function pickBarcode(found: readonly Detected[]): FoundBarcode | null {
  for (const f of found) {
    const code = f.rawValue?.trim() ?? '';
    if ((PRODUCT_FORMATS as readonly string[]).includes(f.format) && /^\d{8,14}$/.test(code)) {
      return { code, format: f.format };
    }
  }
  return null;
}

/** Reads a barcode from a photo, shrunk first so a 12-megapixel picture doesn't take seconds. */
export async function readPhoto(file: Blob, maxLongEdge = 1600): Promise<FoundBarcode | null> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, maxLongEdge / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    throw new Error('This browser can’t read photos here.');
  }
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const detector = await barcodeDetector();
  return pickBarcode(await detector.detect(canvas));
}
