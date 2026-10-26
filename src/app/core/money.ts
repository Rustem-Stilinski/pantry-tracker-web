/** Money and price formatting, plus the categories used on receipts. */

/** Grocery-style categories for receipt lines (same list the receipt reader uses). */
export const RECEIPT_CATEGORIES = [
  'Produce', 'Meat & seafood', 'Dairy & eggs', 'Bakery', 'Pantry', 'Frozen', 'Snacks',
  'Drinks', 'Household', 'Personal care', 'Baby', 'Pet', 'Other',
] as const;

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const usdPrecise = new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 3,
});

/** $3.49, $1,204.50 */
export function money(value: number | null | undefined): string {
  return value == null ? '—' : usd.format(Number(value));
}

/** "$3.49 each" for counted items, "$0.59/lb" otherwise (keeps a third decimal like $0.599/lb). */
export function unitPrice(value: number, unit: string): string {
  const price = usdPrecise.format(Number(value));
  return !unit || unit === 'pcs' ? `${price} each` : `${price}/${unit}`;
}

/** "+25.1%", "−12%" with a real minus sign; rounds to whole percent from 10 up. */
export function percent(value: number): string {
  const abs = Math.abs(value);
  const shown = abs >= 10 ? Math.round(abs).toString() : abs.toFixed(1).replace(/\.0$/, '');
  return `${value < 0 ? '−' : '+'}${shown}%`;
}

/** Two-decimal rounding for cents. */
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Parses what someone typed into a money or amount box: "3.49", "$3.49", "1,204.50". NaN when not a number. */
export function parseAmount(text: string): number {
  const cleaned = String(text ?? '').replace(/[$,\s]/g, '');
  return cleaned === '' ? NaN : Number(cleaned);
}
