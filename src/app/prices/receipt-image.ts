/**
 * Image measurements for reading receipts, on plain gray-level arrays (row by row, 0–255) so they
 * run anywhere and are easy to test. Used by device-reader.ts.
 *
 * Everything starts from "thin strokes": pixels clearly darker than what's a few pixels away on
 * both sides, which is what printed text looks like. Broad dark shapes (a leaf on a bedspread, a
 * shadow, a table edge) are dark on one side only and don't count.
 */

/** Part of a photo, as fractions of its width and height (0 = left/top, 1 = right/bottom). */
export interface Frame {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export const WHOLE_PHOTO: Frame = { left: 0, top: 0, right: 1, bottom: 1 };

/** 1 where a pixel is a thin dark stroke: `delta` darker than the pixels `d` away on both sides. */
export function thinStrokes(gray: ArrayLike<number>, width: number, height: number, d: number, delta: number): Uint8Array {
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const up = Math.max(0, y - d) * width;
    const down = Math.min(height - 1, y + d) * width;
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const v = gray[row + x];
      const across = Math.min(gray[row + Math.max(0, x - d)], gray[row + Math.min(width - 1, x + d)]);
      const along = Math.min(gray[up + x], gray[down + x]);
      if (across - v > delta || along - v > delta) out[row + x] = 1;
    }
  }
  return out;
}

/** Thin strokes after a light blur, so camera grain and paper texture don't count as print. */
export function strokesAround(gray: ArrayLike<number>, width: number, height: number): Uint8Array {
  return thinStrokes(boxMean(gray, width, height, 1), width, height, 3, 30);
}

/** The mean over a (2r+1)² square around each pixel (edges repeat), using an integral image. */
export function boxMean(values: ArrayLike<number>, width: number, height: number, r: number): Float32Array {
  const stride = width + 1;
  const sums = new Float64Array(stride * (height + 1));
  for (let y = 0; y < height; y++) {
    let line = 0;
    for (let x = 0; x < width; x++) {
      line += values[y * width + x];
      sums[(y + 1) * stride + x + 1] = sums[y * stride + x + 1] + line;
    }
  }
  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(height, y + r + 1);
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(width, x + r + 1);
      const total = sums[y1 * stride + x1] - sums[y0 * stride + x1] - sums[y1 * stride + x0] + sums[y0 * stride + x0];
      out[y * width + x] = total / ((y1 - y0) * (x1 - x0));
    }
  }
  return out;
}

/**
 * The receipt is where print is dense: the band of columns with the most of it, then every block
 * of lines within that band (header, items, totals), with a small margin around.
 */
export function frameFromStrokes(density: ArrayLike<number>, width: number, height: number): Frame {
  const text = new Uint8Array(width * height);
  for (let i = 0; i < text.length; i++) text[i] = density[i] > 0.12 ? 1 : 0;

  const columns = new Float32Array(width);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) columns[x] += text[y * width + x];
  const smooth = boxMean(columns, width, 1, 2);
  const colMax = Math.max(...smooth);
  if (colMax <= 0) return WHOLE_PHOTO;
  const bands = runs(Array.from(smooth, (v) => v > colMax * 0.12), Math.round(width * 0.06));
  const band = heaviest(bands, smooth);
  if (!band) return WHOLE_PHOTO;
  // The price column, set apart from the names by a gap: take in nearby bands with real weight.
  const bandMass = mass(smooth, band[0], band[1]);
  for (let grown = true; grown;) {
    grown = false;
    for (const other of bands) {
      const gap = other[0] > band[1] ? other[0] - band[1] : band[0] - other[1];
      if (gap <= 0 || gap > width * 0.15 || mass(smooth, other[0], other[1]) < bandMass * 0.1) continue;
      band[0] = Math.min(band[0], other[0]);
      band[1] = Math.max(band[1], other[1]);
      grown = true;
    }
  }

  const rows = new Float32Array(height);
  for (let y = 0; y < height; y++) for (let x = band[0]; x <= band[1]; x++) rows[y] += text[y * width + x];
  const minRow = Math.max(1, (band[1] - band[0]) * 0.02);
  const blocks = runs(Array.from(rows, (v) => v > minRow), Math.round(height * 0.03));
  if (!blocks.length) return WHOLE_PHOTO;
  const masses = blocks.map(([a, b]) => mass(rows, a, b));
  const heaviestMass = Math.max(...masses);
  const kept = blocks.filter((_, i) => masses[i] >= heaviestMass * 0.05);

  const mx = Math.round(width * 0.03);
  const my = Math.round(height * 0.015);
  const frame: Frame = {
    left: Math.max(0, band[0] - mx) / width,
    top: Math.max(0, kept[0][0] - my) / height,
    right: Math.min(width, band[1] + mx + 1) / width,
    bottom: Math.min(height, kept[kept.length - 1][1] + my + 1) / height,
  };
  // Too small to be a receipt: probably not print at all.
  return (frame.right - frame.left) * (frame.bottom - frame.top) < 0.03 ? WHOLE_PHOTO : frame;
}

/** Slopes tried for the lines of print: −10° to +10° in half degrees. */
const SLOPES = Array.from({ length: 41 }, (_, i) => Math.tan(((i - 20) * 0.5 * Math.PI) / 180));
const FLAT = 20;

/**
 * The slope of the lines of print (dy/dx; + means the right end is lower) for every row. Each
 * overlapping strip of a few lines gets the slope that lines its strokes up into the sharpest rows;
 * strips that can't tell are skipped and a single odd strip is outvoted by its neighbors. This
 * follows a receipt that curls, not just one held at an angle.
 */
export function slopeField(ink: Uint8Array, width: number, height: number): Float32Array {
  const stripHeight = Math.max(120, Math.round(width * 0.25));
  const step = Math.round(stripHeight / 2);
  const reach = Math.ceil((width / 2) * SLOPES[SLOPES.length - 1]) + 1;
  const found: { center: number; slope: number }[] = [];

  for (let top = 0; top < Math.max(1, height - stripHeight / 3); top += step) {
    const bottom = Math.min(height, top + stripHeight);
    const xs: number[] = [];
    const ys: number[] = [];
    for (let y = top; y < bottom; y++) {
      for (let x = 0; x < width; x++) {
        if (ink[y * width + x]) {
          xs.push(x - width / 2);
          ys.push(y - top);
        }
      }
    }
    if (xs.length < 200) continue;
    const profile = new Float32Array(bottom - top + 2 * reach + 1);
    const scores = SLOPES.map((s) => {
      profile.fill(0);
      for (let i = 0; i < xs.length; i++) profile[ys[i] - Math.round(xs[i] * s) + reach]++;
      let score = 0;
      for (const v of profile) score += v * v;
      return score;
    });
    let best = FLAT;
    for (let k = 0; k < scores.length; k++) if (scores[k] > scores[best]) best = k;
    // Keep strips whose best slope is clearly better than flat, or that are flat.
    if (best === FLAT || scores[best] >= scores[FLAT] * 1.03) found.push({ center: (top + bottom) / 2, slope: SLOPES[best] });
  }

  const field = new Float32Array(height);
  if (!found.length) return field;
  const smooth = found.map((_, i) => median(found.slice(Math.max(0, i - 1), i + 2).map((f) => f.slope)));
  for (let y = 0, k = 0; y < height; y++) {
    while (k < found.length - 1 && found[k + 1].center <= y) k++;
    if (y <= found[0].center) field[y] = smooth[0];
    else if (k >= found.length - 1) field[y] = smooth[found.length - 1];
    else {
      const t = (y - found[k].center) / (found[k + 1].center - found[k].center);
      field[y] = smooth[k] + t * (smooth[k + 1] - smooth[k]);
    }
  }
  return field;
}

/** Each output row follows the print's slope through the source: tilted or curled lines come out level. */
export function levelRows(gray: ArrayLike<number>, width: number, height: number, slopeAt: (y: number) => number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height);
  const middle = width / 2;
  for (let y = 0; y < height; y++) {
    const s = slopeAt(y);
    for (let x = 0; x < width; x++) {
      let source = Math.round(y + s * (x - middle));
      if (source < 0) source = 0;
      else if (source >= height) source = height - 1;
      out[y * width + x] = gray[source * width + x];
    }
  }
  return out;
}

/** Stretches of true values, bridging gaps of up to `maxGap`, as [first, last] index pairs. */
export function runs(flags: boolean[], maxGap: number): [number, number][] {
  const out: [number, number][] = [];
  let start = -1;
  let end = -1;
  let gap = 0;
  flags.forEach((on, i) => {
    if (on) {
      if (start < 0) start = i;
      end = i;
      gap = 0;
    } else if (start >= 0 && ++gap > maxGap) {
      out.push([start, end]);
      start = -1;
    }
  });
  if (start >= 0) out.push([start, end]);
  return out;
}

function heaviest(list: [number, number][], values: ArrayLike<number>): [number, number] | null {
  let best: [number, number] | null = null;
  let bestMass = -1;
  for (const run of list) {
    const m = mass(values, run[0], run[1]);
    if (m > bestMass) {
      best = run;
      bestMass = m;
    }
  }
  return best;
}

function mass(values: ArrayLike<number>, from: number, to: number): number {
  let sum = 0;
  for (let i = from; i <= to; i++) sum += values[i];
  return sum;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
