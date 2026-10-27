import { boxMean, frameFromStrokes, levelRows, runs, slopeField, strokesAround, thinStrokes } from './receipt-image';

/** A light page (230) with dark print (40) where `ink(x, y)` says so. */
function page(width: number, height: number, ink: (x: number, y: number) => boolean): Uint8Array {
  const gray = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) gray[y * width + x] = ink(x, y) ? 40 : 230;
  return gray;
}

/** Lines of "print": dashes 2 px tall every 14 px, sloping by `slope` (dy/dx, + = right end lower). */
function printed(width: number, height: number, slope: number, columns: [number, number][]): Uint8Array {
  return page(width, height, (x, y) => {
    if (!columns.some(([a, b]) => x >= a && x <= b)) return false;
    const level = y - slope * (x - width / 2);
    return ((level % 14) + 14) % 14 < 2 && x % 6 < 4; // letters with gaps between them
  });
}

function rowSharpness(gray: ArrayLike<number>, width: number, height: number): number {
  let score = 0;
  for (let y = 0; y < height; y++) {
    let dark = 0;
    for (let x = 0; x < width; x++) if (gray[y * width + x] < 128) dark++;
    score += dark * dark;
  }
  return score;
}

describe('receipt image measurements', () => {
  it('finds runs, bridging short gaps', () => {
    const flags = [0, 1, 1, 0, 1, 0, 0, 0, 1, 1].map(Boolean);
    expect(runs(flags, 1)).toEqual([[1, 4], [8, 9]]);
    expect(runs(flags, 3)).toEqual([[1, 9]]);
    expect(runs([false, false], 2)).toEqual([]);
  });

  it('counts thin dark strokes as print, but not the inside of a broad dark shape', () => {
    const width = 40;
    const height = 20;
    const gray = page(width, height, (x) => x === 10 || (x >= 20 && x < 35));
    const strokes = thinStrokes(gray, width, height, 3, 35);
    expect(strokes[5 * width + 10]).toBe(1); // a 1-px line
    expect(strokes[5 * width + 27]).toBe(0); // the middle of a 15-px block
  });

  it('averages over a square', () => {
    const mean = boxMean([0, 0, 9, 0, 0, 0, 0, 0, 0], 3, 3, 1);
    expect(mean[4]).toBeCloseTo(1);
    expect(mean[0]).toBeCloseTo(0); // corner window holds only zeros
  });

  it('frames the names and the price column, and leaves out specks around them', () => {
    const width = 200;
    const height = 300;
    const density = new Float32Array(width * height);
    for (let y = 50; y <= 250; y++) {
      for (let x = 40; x <= 110; x++) density[y * width + x] = 0.4; // names
      for (let x = 130; x <= 160; x++) density[y * width + x] = 0.4; // prices, after a gap
    }
    for (let i = 0; i < 40; i++) density[(10 + i * 7) * width + 190] = 0.5; // background specks
    const frame = frameFromStrokes(density, width, height);
    // Names start at 0.2 and prices end at 0.8 of the width; the specks sit at 0.95.
    expect(frame.left).toBeGreaterThan(0.12);
    expect(frame.left).toBeLessThan(0.2);
    expect(frame.right).toBeGreaterThan(0.8);
    expect(frame.right).toBeLessThan(0.9);
    expect(frame.top).toBeGreaterThan(0.14);
    expect(frame.bottom).toBeLessThan(0.86);
  });

  it('uses the whole photo when there is no print', () => {
    expect(frameFromStrokes(new Float32Array(100 * 100), 100, 100)).toEqual({ left: 0, top: 0, right: 1, bottom: 1 });
  });

  it('measures the slope of tilted print and levels it', () => {
    const width = 300;
    const height = 400;
    const slope = Math.tan((3 * Math.PI) / 180);
    const gray = printed(width, height, slope, [[20, 180], [220, 280]]);
    const field = slopeField(strokesAround(gray, width, height), width, height);
    for (const y of [60, 200, 340]) expect(Math.atan(field[y]) * (180 / Math.PI)).toBeCloseTo(3, 0);

    const level = levelRows(gray, width, height, (y) => field[y]);
    expect(rowSharpness(level, width, height)).toBeGreaterThan(rowSharpness(gray, width, height) * 1.5);
  });

  it('follows a receipt that curls: flat at the top, tilted further down', () => {
    const width = 300;
    const height = 600;
    const gray = page(width, height, (x, y) => {
      if (x < 20 || x > 280) return false;
      const slope = y < 300 ? 0 : Math.tan((-5 * Math.PI) / 180);
      const level = y - slope * (x - width / 2);
      return ((level % 14) + 14) % 14 < 2 && x % 6 < 4;
    });
    const field = slopeField(strokesAround(gray, width, height), width, height);
    expect(Math.abs(Math.atan(field[60]) * (180 / Math.PI))).toBeLessThan(1);
    expect(Math.atan(field[540]) * (180 / Math.PI)).toBeCloseTo(-5, 0);
  });
});
