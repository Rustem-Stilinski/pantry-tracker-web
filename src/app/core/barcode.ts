/** Barcode helpers with no Angular or browser APIs, so they are easy to unit test. */

/** Product barcodes the scanner looks for: groceries and household goods. */
export const PRODUCT_FORMATS = ['ean_13', 'upc_a', 'ean_8', 'upc_e'] as const;

/**
 * What someone typed from under the bars: "0 36000 29145 2" -> "036000291452".
 * Null when it can't be a product barcode (8, 12, 13 or 14 digits). The server checks the check digit.
 */
export function typedBarcode(text: string): string | null {
  const digits = withoutSeparators(text);
  return /^(\d{8}|\d{12,14})$/.test(digits) ? digits : null;
}

/**
 * Why a typed number can't be a product barcode, in words that say what to fix. The usual slip is leaving
 * out the small digits printed outside the bars at each end of a UPC. (No digit is guessed: a guess could
 * still pass the check and open the wrong product.)
 */
export function typedBarcodeProblem(text: string): string {
  const typed = withoutSeparators(text);
  const example = 'like 0 36000 29145 2';
  if (!typed) return 'Type the numbers printed under the bars.';
  if (/\D/.test(typed)) return 'Use only the numbers printed under the bars.';
  const n = typed.length;
  if (n < 8) {
    return `That’s ${n} ${n === 1 ? 'digit' : 'digits'}. A UPC has 12, including the small digits at each end, ${example}. `
      + '(The 4- or 5-digit stickers on fruit aren’t barcodes.)';
  }
  if (n > 14) return `That’s ${n} digits, more than a barcode has. A UPC has 12, ${example}.`;
  return `That’s ${n} digits. A UPC has 12: include the small digits printed outside the bars at each end, ${example}.`;
}

function withoutSeparators(text: string): string {
  return String(text ?? '').replace(/[\s.\-‐–—]/g, '');
}

/**
 * Spaced the way it's printed on the package. A 13-digit code starting with 0 is a 12-digit UPC:
 * "0036000291452" -> "0 36000 29145 2". Other EAN-13: "4006381333931" -> "4 006381 333931"; EAN-8: "9638 5074".
 */
export function displayBarcode(code: string): string {
  if (/^0\d{12}$/.test(code)) return `${code[1]} ${code.slice(2, 7)} ${code.slice(7, 12)} ${code[12]}`;
  if (/^\d{12}$/.test(code)) return `${code[0]} ${code.slice(1, 6)} ${code.slice(6, 11)} ${code[11]}`;
  if (/^\d{11}$/.test(code)) return `${code[0]} ${code.slice(1, 6)} ${code.slice(6)}`;
  if (/^\d{10}$/.test(code)) return `${code.slice(0, 5)} ${code.slice(5)}`; // a UPC's middle, as Safeway prints it
  if (/^\d{13}$/.test(code)) return `${code[0]} ${code.slice(1, 7)} ${code.slice(7)}`;
  if (/^\d{8}$/.test(code)) return `${code.slice(0, 4)} ${code.slice(4)}`;
  return code;
}

/** The same product code, however it was read: UPC-A "036000291452" is EAN-13 "0036000291452". */
export function sameBarcode(a: string, b: string): boolean {
  const full = (code: string) => (code.length === 12 ? `0${code}` : code);
  return full(a) === full(b);
}

/** "UPC" for US and Canadian products (13 digits starting with 0), else "EAN". */
export function barcodeLabel(code: string): string {
  return /^0\d{12}$/.test(code) ? 'UPC' : 'EAN';
}

/**
 * A run of identical reads before a code counts, so one blurry frame can't open the wrong item.
 * Feed it every read; it answers the code once it has been seen `needed` times in a row within `windowMs`.
 */
export class ReadConfirmer {
  private last = '';
  private count = 0;
  private at = 0;

  constructor(private readonly needed = 2, private readonly windowMs = 1500) {}

  /** Returns the code when it's confirmed, else null. */
  read(code: string, now = Date.now()): string | null {
    if (code === this.last && now - this.at <= this.windowMs) {
      this.count++;
    } else {
      this.last = code;
      this.count = 1;
    }
    this.at = now;
    return this.count >= this.needed ? code : null;
  }

  reset(): void {
    this.last = '';
    this.count = 0;
    this.at = 0;
  }
}

/** Words that say nothing about which product it is. */
const NOISE = new Set([
  'the', 'and', 'with', 'of', 'for', 'in', 'a', 'an', 'oz', 'fl', 'lb', 'lbs', 'ct', 'count', 'pk', 'pack',
  'ml', 'g', 'kg', 'l', 'gal', 'each', 'ea', 'size', 'value', 'family', 'original',
]);

function words(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9%]+/)
      .filter((w) => w.length >= 2 && !NOISE.has(w) && !/^\d+$/.test(w)),
  );
}

/**
 * The household's item names that share the most words with a product name, best first.
 * "Fairlife 2% Reduced Fat Milk, 52 fl oz" finds "2% milk" and "Fairlife 2% milk" from receipts.
 */
export function closestItems(productName: string, names: readonly string[], limit = 3): string[] {
  const wanted = words(productName);
  if (!wanted.size) return [];
  const seen = new Set<string>();
  return names
    .filter((name) => {
      const key = name.trim().toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((name) => {
      let score = 0;
      for (const w of words(name)) if (wanted.has(w)) score++;
      return { name, score };
    })
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score || a.name.length - b.name.length)
    .slice(0, limit)
    .map((m) => m.name);
}
