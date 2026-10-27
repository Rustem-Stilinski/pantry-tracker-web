/**
 * Turns the text read off a receipt photo (on the device, by Tesseract) into a draft receipt.
 * Pure functions only, so they're easy to test against real receipt layouts.
 *
 * What it understands:
 *   GNT LG EGGS 12CT              3.49 F      item line: name, price, optional tax flag
 *   BANANAS                       1.36 F      followed by a weight line
 *     2.31 lb @ 0.59 /lb
 *   2 @ 1.29                                  quantity line, before or after its item
 *   COUPON                        1.00-       discount: taken off the item above
 *   SUBTOTAL / TAX / TOTAL                    receipt totals; payment lines after TOTAL are ignored
 * plus the store name (top lines), the date and the time.
 */
import { DraftItem, ReceiptAlias, ReceiptDraft } from '../core/models';

export type { ReceiptAlias };

export interface ParseOptions {
  /** Store names the household already uses; a match on the receipt header wins. */
  knownStores?: string[];
  /** What printed lines were saved as before, so the person's own names come back. */
  aliases?: ReceiptAlias[];
  /** For rejecting dates in the future. */
  today?: Date;
}

// ---------- patterns ----------

/**
 * A price at the end of a line, with an optional minus sign and tax flag: "3.49 F", "1.00-", "-0.50".
 * Text recognition often reads a one-letter flag such as T as "1", so a single digit counts as a flag too.
 */
const TRAILING_PRICE = /(-)?\s*\$?\s*(\d{1,5}\.\d{2})\s*(-)?\s*[:;,.]?\s*(?:[A-Z]{1,2}|\d|\*)?\s*$/;
/** "2.31 lb @ 0.59 /lb", "1.5 LB @ $2.99/LB"; "lb" is often read as "1b" or "Ib", and "@" as "©". */
const LB = '[L1I|]BS?';
const WEIGHT_DETAIL = new RegExp(
  `(\\d+(?:\\.\\d+)?)\\s*(${LB}|KG|OZ|G)\\b\\.?\\s*[@©®]\\s*\\$?\\s*(\\d*\\.\\d{2,3})\\s*(?:\\/\\s*(?:${LB}|KG|OZ|G)\\b)?`, 'i');
/** Just the quantity, when the price after it is unreadable: "2@56.9", "2.@6.9". */
const QTY_ONLY = /^(\d{1,2})\s*\.?\s*[@©®]/;
/** "2 @ 1.29", "3 AT 0.99", "2 @ $1.29 EA" */
const QTY_DETAIL = /^(\d{1,3})\s*(?:[@©®]|AT)\s*\$?\s*(\d*\.\d{2,3})\b/i;

const SUBTOTAL = /\bSUB\s*-?\s*TOTAL\b/i;
const TAX = /\b(?:SALES\s+)?TAX\b/i;
const TOTAL = /\b(?:GRAND\s+)?TOTAL\b|\bBALANCE\s+DUE\b|\bAMOUNT\s+DUE\b/i;
/** Lines that mention totals but aren't the receipt total. */
const NOT_TOTAL = /\b(?:SAVINGS|SAVED|SAVE|ITEMS?|NUMBER|POINTS|DISCOUNTS?|COUPONS?)\b/i;
/** Discounts and coupons: their amount comes off the item above. */
const DISCOUNT = /\b(?:COUPON|DISCOUNT|SAVINGS|SAVED|PROMO|INSTANT\s+SAV|MEMBER|BONUS\s*CARD|CARD\s+SAV|MFR|MARKDOWN|PRICE\s+REDUCTION|OFF)\b/i;
/** Payment and housekeeping lines, never items. */
const NOT_ITEM = /\b(?:CHANGE|CASH|VISA|MASTERCARD|MASTER\s+CARD|AMEX|DISCOVER|DEBIT|CREDIT|TEND(?:ER)?|PAYMENT|PAID|APPROVED|APPROVAL|AUTH|ACCOUNT|ACCT|CARD\s*#|BALANCE|CASHIER|REGISTER|TERMINAL|TRANS(?:ACTION)?|INVOICE|RECEIPT|THANK|SURVEY|WWW|HTTPS?|CHIP|PIN|AID|ENTRY\s+METHOD|POINTS|REWARDS)\b/i;

/** Well-known store names, matched in the receipt header. */
const CHAINS: [RegExp, string][] = [
  [/\bWAL\s*\*?\s*MART\b/i, 'Walmart'],
  [/\bTARGET\b/i, 'Target'],
  [/\bCOSTCO\b/i, 'Costco'],
  [/\bSAM'?S\s+CLUB\b/i, "Sam's Club"],
  [/\bBJ'?S\b/i, "BJ's"],
  [/\bTRADER\s+JOE'?S\b/i, "Trader Joe's"],
  [/\bWHOLE\s+FOODS\b/i, 'Whole Foods'],
  [/\bHARRIS\s+TEETER\b/i, 'Harris Teeter'],
  [/\bGIANT\b/i, 'Giant'],
  [/\bSAFEWAY\b/i, 'Safeway'],
  [/\bWEGMANS\b/i, 'Wegmans'],
  [/\bALDI\b/i, 'Aldi'],
  [/\bLIDL\b/i, 'Lidl'],
  [/\bKROGER\b/i, 'Kroger'],
  [/\bPUBLIX\b/i, 'Publix'],
  [/\bFOOD\s+LION\b/i, 'Food Lion'],
  [/\bH\s*MART\b/i, 'H Mart'],
  [/\bSPROUTS\b/i, 'Sprouts'],
  [/\bCVS\b/i, 'CVS'],
  [/\bWALGREENS\b/i, 'Walgreens'],
  [/\bHOME\s+DEPOT\b/i, 'Home Depot'],
  [/\bLOWE'?S\b/i, "Lowe's"],
  [/\bDOLLAR\s+TREE\b/i, 'Dollar Tree'],
  [/\bDOLLAR\s+GENERAL\b/i, 'Dollar General'],
];

/** Keyword → category, checked in order; the first match wins. */
const CATEGORY_RULES: [RegExp, string][] = [
  [/\b(?:DEPOSIT|BAG\s*(?:FEE|CHARGE)|PAPER\s+BAG|CRV)\b/i, 'Other'],
  [/\b(?:DIAPER|WIPES|FORMULA|BABY)\b/i, 'Baby'],
  [/\b(?:DOG|CAT|PET|KIBBLE|LITTER)\b/i, 'Pet'],
  [/\b(?:SHAMPOO|CONDITIONER|TOOTH\s*PASTE|TOOTHPASTE|TOOTHBRUSH|DEODORANT|BODY\s*WASH|LOTION|RAZOR|FLOSS|VITAMIN|IBUPROFEN|TYLENOL|ADVIL|BANDAGE|TAMPON|PADS)\b/i, 'Personal care'],
  [/\b(?:PAPER\s*TOWEL|TOWELS?|TISSUE|TOILET|BATH\s*TISSUE|NAPKIN|DETERGENT|BLEACH|DISH|SOAP|SPONGE|TRASH|GARBAGE|FOIL|PLASTIC\s*WRAP|ZIPLOC|CLEANER|LYSOL|CLOROX|BATTER(?:Y|IES)|LIGHT\s*BULB)\b/i, 'Household'],
  [/\b(?:FROZEN|FRZ|ICE\s*CREAM|PIZZA)\b/i, 'Frozen'],
  [/\b(?:MILK|MLK|EGGS?|CHEESE|CHS|YOGURT|YOG|BUTTER|BTR|CREAM|KEFIR|COTTAGE)\b/i, 'Dairy & eggs'],
  [/\b(?:CHICKEN|CHKN|BEEF|PORK|TURKEY|HAM|BACON|SAUSAGE|STEAK|GROUND|LAMB|SALMON|TUNA|SHRIMP|FISH|TILAPIA|COD|DELI)\b/i, 'Meat & seafood'],
  [/\b(?:BREAD|SOURDOUGH|LOAF|BAGELS?|BUNS?|ROLLS?|TORTILLAS?|MUFFINS?|CROISSANTS?|BAGUETTE|PITA|CAKE|DONUTS?)\b/i, 'Bakery'],
  [/\b(?:WATER|SODA|COLA|COKE|PEPSI|SPRITE|LACROIX|JUICE|COFFEE|TEA|BEER|WINE|SELTZER|SPARKLING|KOMBUCHA|GATORADE|DRINK)\b/i, 'Drinks'],
  [/\b(?:CHIPS|CRACKERS?|COOKIES?|CANDY|CHOC(?:OLATE)?|POPCORN|PRETZELS?|NUTS|ALMONDS|GRANOLA|BAR|BARS)\b/i, 'Snacks'],
  [/\b(?:BANANAS?|APPLES?|ORANGES?|LEMONS?|LIMES?|GRAPES?|BERR(?:Y|IES)|STRAWB\w*|BLUEB\w*|AVOCADOS?|AVOCADO|TOMATO(?:ES)?|POTATO(?:ES)?|ONIONS?|GARLIC|LETTUCE|SPINACH|KALE|CARROTS?|CUCUMBERS?|PEPPERS?|BROCCOLI|CELERY|MUSHROOMS?|CILANTRO|PARSLEY|GINGER|PEARS?|PEACH(?:ES)?|MANGO(?:ES)?|PINEAPPLE|MELON|WATERMELON|CABBAGE|ZUCCHINI|SQUASH|CORN|PRODUCE|ORGANIC)\b/i, 'Produce'],
  [/\b(?:RICE|PASTA|SPAGHETTI|NOODLES?|FLOUR|SUGAR|SALT|OIL|VINEGAR|SAUCE|KETCHUP|MAYO|MUSTARD|BEANS|LENTILS|CEREAL|OATS|OATMEAL|SOUP|BROTH|STOCK|SPICE|HONEY|PEANUT|JAM|JELLY|SYRUP|CANNED|CAN)\b/i, 'Pantry'],
];

// ---------- public API ----------

export function parseReceiptText(text: string, options: ParseOptions = {}): ReceiptDraft {
  const today = options.today ?? new Date();
  const lines = text.split(/\r?\n/).map(cleanLine).filter((l) => l.length > 0);

  const items: Item[] = [];
  let subtotal: number | null = null;
  let tax: number | null = null;
  let total: number | null = null;
  let pendingDetail: Detail | null = null;
  let nameOnly: string | null = null;
  let firstItemIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const price = trailingPrice(line);

    if (SUBTOTAL.test(line)) {
      if (price) subtotal = price.value;
      nameOnly = null;
      continue;
    }
    if (TAX.test(line) && !/\bTAXABLE\b/i.test(line)) {
      if (price) tax = round2((tax ?? 0) + price.value);
      nameOnly = null;
      continue;
    }
    if (TOTAL.test(line) && !NOT_TOTAL.test(line)) {
      if (price) {
        total = price.value;
        break; // everything after the total is payment, change and footer
      }
      continue;
    }

    const weight = WEIGHT_DETAIL.exec(line);
    const qty = QTY_DETAIL.exec(line);
    const words = letters(line.replace(WEIGHT_DETAIL, '').replace(TRAILING_PRICE, ''));

    // "2.31 lb @ 0.59 /lb   1.36" or "2 @ 1.29": details for the item above (or below).
    if ((weight || qty) && words < 3) {
      // A price after the "@ price" part is the line total; the "@ price" itself is the unit price.
      const match = (weight ?? qty)!;
      const lineTotal = price && price.index >= match.index + match[0].length - 1 ? price.value : null;
      const detail: Detail = weight
        ? { quantity: Number(weight[1]), unit: weightUnit(weight[2]), unitPrice: Number(weight[3]), lineTotal }
        : { quantity: Number(qty![1]), unit: 'pcs', unitPrice: Number(qty![2]), lineTotal };
      const previous = items[items.length - 1];
      if (previous && !previous.detailed && fits(detail, previous)) {
        applyDetail(previous, detail);
      } else if (nameOnly) {
        // Name on one line, details (with the price) on the next.
        const lineTotal = detail.lineTotal ?? round2(detail.quantity * detail.unitPrice);
        items.push(newItem(nameOnly, lineTotal));
        applyDetail(items[items.length - 1], { ...detail, lineTotal });
        nameOnly = null;
      } else {
        pendingDetail = detail;
      }
      continue;
    }

    // "2@56.9": the quantity is clear even if its price isn't; the item's line total gives the price.
    const qtyOnly = !weight && !qty ? QTY_ONLY.exec(line) : null;
    if (qtyOnly && words < 3 && !price) {
      const quantity = Number(qtyOnly[1]);
      const previous = items[items.length - 1];
      if (quantity > 1 && previous && !previous.detailed) {
        previous.quantity = quantity;
        previous.unitPrice = round3(previous.lineTotal / quantity);
        previous.detailed = true;
      }
      continue;
    }

    if (price && DISCOUNT.test(line) && items.length) {
      const previous = items[items.length - 1];
      previous.lineTotal = round2(Math.max(0, previous.lineTotal - Math.abs(price.value)));
      previous.unitPrice = round3(previous.lineTotal / previous.quantity);
      continue;
    }
    if (price && price.negative && items.length) {
      const previous = items[items.length - 1];
      previous.lineTotal = round2(Math.max(0, previous.lineTotal - price.value));
      previous.unitPrice = round3(previous.lineTotal / previous.quantity);
      continue;
    }

    if (NOT_ITEM.test(line)) {
      nameOnly = null;
      continue;
    }

    if (price) {
      const namePart = stripCodes(line.slice(0, price.index));
      if (letters(namePart) >= 2) {
        if (firstItemIndex < 0) firstItemIndex = i;
        const item = newItem(namePart, price.value);
        if (pendingDetail && fits(pendingDetail, item)) applyDetail(item, pendingDetail);
        pendingDetail = null;
        items.push(item);
        nameOnly = null;
      } else if (nameOnly) {
        // Name on one line, price alone on the next.
        if (firstItemIndex < 0) firstItemIndex = i - 1;
        items.push(newItem(nameOnly, price.value));
        nameOnly = null;
      }
      continue;
    }

    // A line of text without a price may be an item name whose price is on the next line.
    nameOnly = letters(line) >= 3 ? stripCodes(line) : null;
  }

  const header = lines.slice(0, firstItemIndex >= 0 ? Math.min(firstItemIndex, 8) : 8);
  const draftItems = items.map((item) => toDraftItem(item, options.aliases ?? []));
  const linesSum = round2(draftItems.reduce((sum, item) => sum + item.lineTotal, 0));

  return {
    storeName: findStore(header, options.knownStores ?? []),
    purchaseDate: findDate(lines, today),
    purchaseTime: findTime(lines),
    currency: 'USD',
    items: draftItems,
    subtotal,
    tax,
    total,
    notes: notesFor(draftItems.length, linesSum, tax, total),
  };
}

/**
 * Several readings of the same photos (different layout modes) usually disagree on a line or two.
 * Keep the one that best matches what the receipt says about itself: lines adding up to the printed
 * subtotal and total, more items found, quantity and weight lines understood.
 */
export function bestReading(texts: string[], options: ParseOptions = {}): ReceiptDraft {
  let best: ReceiptDraft | null = null;
  let bestScore = -Infinity;
  for (const text of texts) {
    const draft = parseReceiptText(text, options);
    const score = readingScore(draft);
    if (score > bestScore) {
      best = draft;
      bestScore = score;
    }
  }
  return best ?? parseReceiptText('', options);
}

export function readingScore(draft: ReceiptDraft): number {
  const lines = draft.items.reduce((sum, item) => sum + item.lineTotal, 0);
  let score = draft.items.length * 3;
  if (draft.subtotal != null) score += Math.abs(lines - draft.subtotal) <= 0.05 ? 30 : -Math.min(Math.abs(lines - draft.subtotal), 20);
  if (draft.total != null) {
    const off = Math.abs(lines + (draft.tax ?? 0) - draft.total);
    score += off <= 0.05 ? 50 : -Math.min(off, 20);
  }
  score += draft.items.filter((item) => item.quantity !== 1 || item.unit !== 'pcs').length;
  score -= draft.items.filter((item) => letters(item.receiptText ?? '') < 3).length * 2;
  if (draft.storeName) score += 2;
  if (draft.purchaseDate) score += 2;
  return score;
}

/** Comparable form of a printed line: no prices, codes or tax flags, single spaces, upper case. */
export function aliasKey(receiptText: string): string {
  return receiptText
    .toUpperCase()
    .replace(/\$?\d{1,5}\.\d{2}\s*-?\s*(?:[A-Z]{1,2}|\d|\*)?\s*$/, ' ')
    .replace(/\b\d{5,}\b/g, ' ')
    .replace(/[^A-Z0-9%& ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The best learned name for a printed line: exact match first, then a close one (OCR misreads a letter). */
export function matchAlias(receiptText: string, aliases: ReceiptAlias[]): ReceiptAlias | null {
  const key = aliasKey(receiptText);
  if (!key) return null;
  let best: ReceiptAlias | null = null;
  let bestScore = 0;
  for (const alias of aliases) {
    const other = aliasKey(alias.receiptText);
    if (!other) continue;
    if (other === key) return alias;
    if (Math.min(key.length, other.length) < 5) continue;
    const score = similarity(key, other);
    if (score > bestScore) {
      best = alias;
      bestScore = score;
    }
  }
  return bestScore >= 0.8 ? best : null;
}

export function categoryFor(name: string): string {
  for (const [pattern, category] of CATEGORY_RULES) {
    if (pattern.test(name)) return category;
  }
  return 'Other';
}

// ---------- internals ----------

interface Item {
  receiptText: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  lineTotal: number;
  detailed: boolean;
}

interface Detail {
  quantity: number;
  unit: string;
  unitPrice: number;
  lineTotal: number | null;
}

function newItem(receiptText: string, lineTotal: number): Item {
  return { receiptText: receiptText.trim(), quantity: 1, unit: 'pcs', unitPrice: lineTotal, lineTotal, detailed: false };
}

/** Does "2 @ 1.29" belong to an item whose line total is 2.58? Allows a few cents of rounding. */
function fits(detail: Detail, item: Item): boolean {
  const expected = detail.lineTotal ?? detail.quantity * detail.unitPrice;
  return Math.abs(expected - item.lineTotal) <= 0.03
    || Math.abs(detail.quantity * detail.unitPrice - item.lineTotal) <= 0.03
    // Some receipts print the unit price on the item line and the line total on the quantity line.
    || (detail.lineTotal != null && Math.abs(detail.unitPrice - item.lineTotal) < 0.015);
}

function applyDetail(item: Item, detail: Detail): void {
  item.quantity = detail.quantity;
  item.unit = detail.unit;
  item.unitPrice = detail.unitPrice;
  if (detail.lineTotal != null) {
    item.lineTotal = detail.lineTotal;
    // The line total is the more reliable number; a misread unit price (3.48 for 3.49) follows it.
    const derived = round3(detail.lineTotal / detail.quantity);
    if (Math.abs(derived - detail.unitPrice) <= 0.02) item.unitPrice = derived;
  }
  item.detailed = true;
}

function toDraftItem(item: Item, aliases: ReceiptAlias[]): DraftItem {
  const alias = matchAlias(item.receiptText, aliases);
  const weighed = item.unit !== 'pcs';
  return {
    receiptText: item.receiptText,
    name: alias?.name ?? readableName(item.receiptText),
    quantity: item.quantity,
    unit: weighed || !alias ? item.unit : alias.unit || 'pcs',
    unitPrice: item.unit === 'pcs' && alias && alias.unit !== 'pcs' ? round3(item.lineTotal / item.quantity) : item.unitPrice,
    lineTotal: item.lineTotal,
    category: alias?.category ?? categoryFor(item.receiptText),
  };
}

/** "JASMINE RICE 20LB" → "Jasmine rice 20lb": sentence case reads better than shouting. */
function readableName(text: string): string {
  const unbalanced = (text.match(/\(/g) ?? []).length !== (text.match(/\)/g) ?? []).length;
  const lower = (unbalanced ? text.replace(/[()]/g, ' ') : text).toLowerCase().replace(/\s+/g, ' ').trim();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function cleanLine(raw: string): string {
  return raw
    .replace(/[|}{[\]_~`"“”§]/g, ' ')
    .replace(/(^|\s)[eEoODQ£@©](\.\d{2})(?=\s|$)/g, (_, before, cents) => `${before}0${cents}`) // e.99 or O.99 is 0.99
    .replace(/(\d)\s?[,.]\s?(\d{2})(?!\d)/g, '$1.$2') // "3,49" or "3. 49" → "3.49"
    .replace(/\s+/g, ' ')
    .trim();
}

function trailingPrice(line: string): { value: number; negative: boolean; index: number } | null {
  const match = TRAILING_PRICE.exec(line);
  if (!match) return null;
  return { value: Number(match[2]), negative: Boolean(match[1] || match[3]), index: match.index };
}

/** Removes item numbers, PLU codes and leftover symbols: "E 1234567 KS WATER" → "KS WATER". */
function stripCodes(text: string): string {
  return text
    .replace(/^(?:[A-Z]\s+)?\d{4,}\s+/, '')
    .replace(/\b\d{6,}\b/g, ' ')
    .replace(/[@#*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function letters(text: string): number {
  return (text.match(/[A-Za-z]/g) ?? []).length;
}

function weightUnit(raw: string): string {
  const unit = raw.toLowerCase();
  return /^[l1i|]bs?$/.test(unit) ? 'lb' : unit;
}

function findStore(header: string[], knownStores: string[]): string | null {
  const text = header.join(' ');
  const upper = text.toUpperCase();
  const known = knownStores.find((store) => store.length >= 3 && upper.includes(store.toUpperCase()));
  if (known) return known;
  for (const [pattern, name] of CHAINS) {
    if (pattern.test(text)) return knownStores.find((s) => s.toLowerCase() === name.toLowerCase()) ?? name;
  }
  // Otherwise the first header line that looks like a name, not an address, phone or date.
  const candidate = header.find((line) =>
    letters(line) >= 3
    && averageWordLength(line) >= 3
    && !/\d{3}[-.) ]\s*\d{3}[-. ]\d{4}/.test(line)
    && !/\b(?:ST|AVE|RD|BLVD|DR|HWY|PIKE|SUITE|STE|LN|WAY)\b\.?/i.test(line)
    && !/\b\d{5}(?:-\d{4})?\b/.test(line)
    && !/\b(?:WELCOME|STORE\s*#|STORE\s+\d|MANAGER|OPEN|HOURS)\b/i.test(line)
    && !/\d{1,2}[/-]\d{1,2}[/-]\d{2,4}/.test(line));
  return candidate ? titleCase(candidate.replace(/[^A-Za-z0-9&' ]/g, ' ').replace(/\s+/g, ' ').trim()) : null;
}

function averageWordLength(line: string): number {
  const words = line.split(/\s+/).filter((w) => /[A-Za-z]/.test(w));
  return words.length ? words.reduce((sum, w) => sum + w.length, 0) / words.length : 0;
}

function titleCase(text: string): string {
  return text.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase()).replace(/'S\b/g, "'s");
}

function findDate(lines: string[], today: Date): string | null {
  const todayKey = isoDate(today);
  for (const line of lines) {
    let match = /\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/.exec(line);
    let year: number, month: number, day: number;
    if (match) {
      [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
    } else {
      match = /\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})\b/.exec(line);
      if (!match) continue;
      [month, day, year] = [Number(match[1]), Number(match[2]), Number(match[3])];
      if (year < 100) year += 2000;
    }
    // A zero read as 6, 8 or 9 turns October into "16", "18" or "19".
    if (month >= 13 && month <= 19) month = 10;
    if (month < 1 || month > 12 || day < 1 || day > 31 || year < 2000) continue;
    const key = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (key <= todayKey) return key;
  }
  return null;
}

function findTime(lines: string[]): string | null {
  for (const line of lines) {
    const match = /\b(\d{1,2}):(\d{2})(?::\d{2})?\s*([AP])?\.?M?\b/i.exec(line);
    if (!match) continue;
    let hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour > 23 || minute > 59) continue;
    const half = match[3]?.toUpperCase();
    if (half === 'P' && hour < 12) hour += 12;
    if (half === 'A' && hour === 12) hour = 0;
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }
  return null;
}

function notesFor(count: number, linesSum: number, tax: number | null, total: number | null): string {
  if (count === 0) {
    return 'No items were found in this photo. Try a sharper, flatter photo in good light, or add the lines by hand.';
  }
  const base = 'Read on this device. Check each line: names stay as printed until you fix them once, and the app remembers your fixes.';
  if (total != null && Math.abs(linesSum + (tax ?? 0) - total) > 0.05) {
    return `${base} The lines don't add up to the receipt total yet, so a line may be missing or misread.`;
  }
  return base;
}

/** 1 = identical, 0 = nothing in common (normalized Levenshtein distance). */
function similarity(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  let previous = Array.from({ length: cols }, (_, j) => j);
  for (let i = 1; i < rows; i++) {
    const current = [i];
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
    }
    previous = current;
  }
  return 1 - previous[cols - 1] / Math.max(a.length, b.length);
}

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function round3(value: number): number {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}
