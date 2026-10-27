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
 *   WT   BANANAS                  1.22 B      a department code before the name (Wegmans: WT, SC, MR)
 *   **** BALANCE                109.22        the total on Wegmans receipts, then card and tax breakdown
 * plus the store name (top lines), the date and the time.
 *
 * Photos of real receipts are read imperfectly, so it also copes with the usual slips: "@" read as
 * "8" ("285.49" for "2 @ 5.49"), one wrong digit in a price (checked against the quantity line and
 * the receipt's own total), and specks of the table or bedspread read as letters at the line ends.
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
 * Text recognition often reads a one-letter flag such as T as "1" or B as "8b", so those count as flags too.
 */
const TRAILING_PRICE = /(-)?\s*\$?\s*(\d{1,5}\.\d{2})\s*(-)?\s*[:;,.]?\s*(?:[A-Za-z]{1,2}|\d[A-Za-z]?|\*)?\s*$/;
/** "2.31 lb @ 0.59 /lb", "1.5 LB @ $2.99/LB"; "lb" is often read as "1b" or "Ib", and "@" as "©". */
const LB = '[L1I|]BS?';
const WEIGHT_DETAIL = new RegExp(
  `(\\d+(?:\\.\\d+)?)\\s*(${LB}|KG|OZ|G)\\b\\.?\\s*[@©®]\\s*\\$?\\s*(\\d*\\.\\d{2,3})\\s*(?:\\/\\s*(?:${LB}|KG|OZ|G)\\b)?`, 'i');
/** Just the quantity, when the price after it is unreadable: "2@56.9", "2.@6.9". */
const QTY_ONLY = /^(\d{1,2})\s*\.?\s*[@©®]/;
/** "2 @ 1.29", "3 AT 0.99", "2 @ $1.29 EA" */
const QTY_DETAIL = /^(\d{1,3})\s*(?:[@©®]|AT)\s*\$?\s*(\d*\.\d{2,3})\b/i;
/** "2 @ 5.49" with the "@" read as a letter or digit and the spaces lost: "285.49", "2865.49", "3 8 0.05". */
const LOOSE_QTY = /^([2-9])\s*[8@©®&0QB]{1,2}\s*(\d{1,3}\.\d{2})$/;
/** A quantity read onto the start of the item line: "2 @ 2.29 GOYA BLK BEAN SOUP 4.58". */
const INLINE_QTY = /^([2-9])\s*[@©®]\s*\$?([\d.]*\d)?\s*(?:\d+\s+)?(?=[A-Za-z])/;

const SUBTOTAL = /\bSUB\s*-?\s*TOTAL\b/i;
const TAX = /\b(?:SALES\s+)?TAX\b/i;
const TAX_TOTAL = /\bTOTAL\s+TAX\b|\bTAX\s+TOTAL\b/i;
const TOTAL = /\b(?:GRAND\s+)?TOTAL\b|\bBALANCE(?:\s+DUE)?\b|\bAMOUNT\s+DUE\b/i;
/** Lines that mention totals but aren't the receipt total. */
const NOT_TOTAL = /\b(?:SAVINGS|SAVED|SAVE|ITEMS?|NUMBER|POINTS|DISCOUNTS?|COUPONS?|GIFT|REMAINING|PREVIOUS|AVAILABLE|BEGINNING|ENDING)\b/i;
/** Card and cash lines: once these start, the items are over. */
const PAYMENT = /\b(?:VISA|MASTER\s*CARD|AMEX|AMERICAN\s+EXPRESS|DISCOVER|DEBIT|CREDIT|EBT|CASH|TENDER(?:ED)?|PURCHASE|CARD\s*(?:NUMBER|NO|#)|APPROVED|AUTH(?:ORIZATION)?|CHANGE)\b/i;
/** "Shoppers Club would have saved $0.80", "You saved 2.00": a summary, not a discount on an item. */
const SAVINGS_SUMMARY = /\bWOULD\s+HAVE\b|\bYOU\s+SAVED\b|\bTOTAL\s+SAVINGS\b|\bSAVINGS\s+TODAY\b/i;
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

/** Other giveaways when the logo itself is hard to read: script logos, slogans, loyalty programs. */
const STORE_HINTS: [RegExp, string][] = [
  [/\bW?E[GC]\s?(?:M|RN|NN)\s?A\s?N\s?S\b/i, 'Wegmans'],
  [/\bSHOPPERS\s+CLUB\b|\bDAY\s+YOU\s+GET\b/i, 'Wegmans'],
  [/\bBONUS\s*CARD\b/i, 'Giant'],
  [/\bVIC\s+CARD\b/i, 'Harris Teeter'],
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
  const reading = readLines(text);
  repairDigits(reading.items, reading.subtotal, reading.tax, reading.total, []);
  return toDraft(reading, [reading], options);
}

/**
 * Several readings of the same photos (different layout modes) usually disagree on a line or two,
 * and each one misreads something. Start from the reading that best matches what the receipt says
 * about itself, then let the others fill in: a line it missed, a quantity line it couldn't read,
 * another reading of a price. Those are only used where they make the lines add up to the printed
 * total exactly, so a combined reading is never worse than the best single one.
 */
export function bestReading(texts: string[], options: ParseOptions = {}): ReceiptDraft {
  const readings = texts.map(readLines);
  if (!readings.length) return parseReceiptText('', options);
  const ranked = readings
    .map((reading) => ({ reading, score: readingScore(reading, options.knownStores ?? []) }))
    .sort((a, b) => b.score - a.score)
    .map((r) => r.reading);
  const combined = combine(ranked[0], ranked.slice(1));
  return toDraft(combined, ranked, options);
}

/** How well a reading agrees with itself: lines adding up to the printed totals, items found, details understood. */
function readingScore(original: Reading, knownStores: string[]): number {
  const items = original.items.map(copyItem);
  repairDigits(items, original.subtotal, original.tax, original.total, []);
  const lines = items.reduce((sum, item) => sum + item.lineTotal, 0);
  let score = items.length * 3;
  if (original.subtotal != null) score += Math.abs(lines - original.subtotal) <= 0.05 ? 30 : -Math.min(Math.abs(lines - original.subtotal), 20);
  if (original.total != null) {
    const off = Math.abs(lines + (original.tax ?? 0) - original.total);
    score += off <= 0.05 ? 50 : -Math.min(off, 20);
  }
  score += items.filter((item) => item.detailed).length;
  score -= items.filter((item) => letters(item.receiptText) < 3).length * 2;
  if (findStore(original.header, original.lines, knownStores)) score += 2;
  if (findDate(original.lines, new Date(9999, 11, 31))) score += 2;
  return score;
}

/** What one reading of the text says, before names and categories are filled in. */
interface Reading {
  lines: string[];
  header: string[];
  items: Item[];
  subtotal: number | null;
  tax: number | null;
  total: number | null;
}

function readLines(text: string): Reading {
  const lines = text.split(/\r?\n/).map(cleanLine).filter((l) => l.length > 0);

  const items: Item[] = [];
  const taxes: Tax[] = [];
  let subtotal: number | null = null;
  let total: number | null = null;
  let pendingDetail: Detail | null = null;
  let nameOnly: string | null = null;
  let firstItemIndex = -1;
  let paid = false;
  let lonePrice: number | null = null; // a price alone on the line above
  // Which side of its item the quantity lines are printed on, going by the ones matched so far.
  let detailsAbove = 0;
  let detailsBelow = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const price = trailingPrice(line);
    const priceAbove = lonePrice;
    lonePrice = price && letters(line) < 2 ? price.value : null;

    if (SUBTOTAL.test(line)) {
      const value = price?.value ?? takeLonePrice(lines, i);
      if (value != null) {
        subtotal = value;
        if (!price) i++;
      }
      nameOnly = null;
      continue;
    }
    if (TAX.test(line) && !/\bTAXABLE\b/i.test(line)) {
      // "TAX" with its amount on the next line, unless that amount belongs to a total printed after it.
      let value = price?.value ?? null;
      if (value == null && !(TOTAL.test(lines[i + 2] ?? '') && !trailingPrice(lines[i + 2]))) {
        value = takeLonePrice(lines, i);
        const sum = items.reduce((s, item) => s + item.lineTotal, 0);
        if (value != null && items.length && value > sum * 0.3) value = null; // that's the total, not the tax
        if (value != null) i++;
      }
      // On a curled receipt the amount can sit on the line above its label.
      if (value == null && priceAbove != null) value = priceAbove;
      if (value != null) taxes.push({ value, isTotal: TAX_TOTAL.test(line), afterTotal: false });
      nameOnly = null;
      lonePrice = null;
      continue;
    }
    if (TOTAL.test(line) && !NOT_TOTAL.test(line)) {
      const value = price?.value ?? takeLonePrice(lines, i) ?? priceAbove;
      if (value != null) {
        total = value;
        // Everything after the total is payment, change and footer; some receipts break the tax down there.
        for (const rest of lines.slice(i + 1)) {
          const amount = trailingPrice(rest);
          if (amount && TAX.test(rest) && !/\bTAXABLE\b/i.test(rest)) {
            taxes.push({ value: amount.value, isTotal: TAX_TOTAL.test(rest), afterTotal: true });
          }
        }
        break;
      }
      continue;
    }
    if (paid || (items.length && PAYMENT.test(line))) {
      paid = true; // card slips and change: no more items, only the tax and total lines above count
      nameOnly = null;
      continue;
    }
    if (SAVINGS_SUMMARY.test(line)) {
      nameOnly = null;
      continue;
    }

    const weight = WEIGHT_DETAIL.exec(line);
    const qty = QTY_DETAIL.exec(line);
    // Letters outside the "2 @ 1.29" part and the price. Scraps without a 3-letter word ("Le B98",
    // an unreadable price) don't make it a name.
    const found = weight ?? qty;
    const rest = (found ? line.slice(0, found.index) + ' ' + line.slice(found.index + found[0].length) : line).replace(TRAILING_PRICE, '');
    const words = /[A-Za-z]{3}/.test(rest) ? letters(rest) : 0;

    // "2.31 lb @ 0.59 /lb   1.36" or "2 @ 1.29": details for the item above (or below).
    if ((weight || qty) && words < 3) {
      // A price after the "@ price" part is the line total; the "@ price" itself is the unit price.
      const match = (weight ?? qty)!;
      const lineTotal = price && price.index >= match.index + match[0].length - 1 ? price.value : null;
      const detail: Detail = weight
        ? { quantity: Number(weight[1]), unit: weightUnit(weight[2]), unitPrice: Number(weight[3]), lineTotal }
        : { quantity: Number(qty![1]), unit: 'pcs', unitPrice: Number(qty![2]), lineTotal };
      const previous = items[items.length - 1];
      if (previous && !previous.detailed && detailsAbove <= detailsBelow && belongsTo(detail, previous)) {
        attach(previous, detail);
        detailsBelow++;
      } else if (nameOnly && detail.lineTotal != null) {
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

    // "285.49": a quantity line with the "@" misread. Only kept if the next item's price agrees.
    const loose = !nameOnly && words === 0 ? LOOSE_QTY.exec(line) : null;
    if (loose) {
      pendingDetail = { quantity: Number(loose[1]), unit: 'pcs', unitPrice: Number.NaN, lineTotal: null, hint: loose[2] };
      continue;
    }

    // "2@56.9": the quantity is clear even if its price isn't; the item's line total gives the price.
    const qtyOnly = !weight && !qty ? QTY_ONLY.exec(line) : null;
    if (qtyOnly && words < 3 && !price) {
      const detail: Detail = { quantity: Number(qtyOnly[1]), unit: 'pcs', unitPrice: Number.NaN, lineTotal: null, hint: '' };
      const previous = items[items.length - 1];
      if (detail.quantity < 2) continue;
      if (previous && !previous.detailed && detailsAbove <= detailsBelow && attach(previous, detail)) detailsBelow++;
      else pendingDetail = detail;
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
      let namePart = line.slice(0, price.index);
      const inline = INLINE_QTY.exec(namePart);
      if (inline) namePart = namePart.slice(inline[0].length);
      namePart = stripCodes(namePart);
      if (letters(namePart) >= 2) {
        if (firstItemIndex < 0) firstItemIndex = i;
        const item = newItem(namePart, price.value);
        const detail = pendingDetail
          ?? (inline ? { quantity: Number(inline[1]), unit: 'pcs', unitPrice: Number.NaN, lineTotal: null, hint: inline[2] ?? '' } : null);
        if (detail && attach(item, detail) && detail === pendingDetail) detailsAbove++;
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

  // A "tax" bigger than half the total was really the total, read onto the wrong line. When the
  // subtotal and total are both printed, the tax is their difference whatever was read for it.
  let tax = resolveTax(taxes);
  if (tax != null && total != null && tax >= total / 2) tax = null;
  if (subtotal != null && total != null && total >= subtotal && total - subtotal < total / 2) tax = round2(total - subtotal);
  const header = lines.slice(0, firstItemIndex >= 0 ? Math.min(firstItemIndex, 8) : 8);
  return { lines, header, items, subtotal, tax, total };
}

function toDraft(reading: Reading, all: Reading[], options: ParseOptions): ReceiptDraft {
  const today = options.today ?? new Date();
  const knownStores = options.knownStores ?? [];
  const draftItems = reading.items.map((item) => toDraftItem(item, options.aliases ?? []));
  const linesSum = round2(draftItems.reduce((sum, item) => sum + item.lineTotal, 0));
  // When the lines don't add up, point at prices that were also read with one digit different:
  // that's what a misread looks like (a 5 printed faintly reads as a 6).
  const target = reading.subtotal ?? (reading.total != null ? round2(reading.total - (reading.tax ?? 0)) : null);
  if (target != null && Math.abs(linesSum - target) > 0.005) {
    reading.items.forEach((item, i) => {
      const best = item.alternatives
        .filter((a) => oneDigitOff(a.lineTotal.toFixed(2), item.lineTotal.toFixed(2)))
        .sort((a, b) => b.votes - a.votes)[0];
      if (best) draftItems[i].suggestion = best.lineTotal;
    });
  }
  // The store, date and time from this reading, or from another one that caught them.
  const first = <T>(find: (r: Reading) => T | null): T | null => {
    for (const r of [reading, ...all]) {
      const found = find(r);
      if (found != null) return found;
    }
    return null;
  };
  return {
    storeName: first((r) => findStore(r.header, r.lines, knownStores)),
    purchaseDate: first((r) => findDate(r.lines, today)),
    purchaseTime: first((r) => findTime(r.lines)),
    currency: 'USD',
    items: draftItems,
    subtotal: reading.subtotal,
    tax: reading.tax,
    total: reading.total,
    notes: notesFor(draftItems.length, linesSum, reading.tax, reading.total, draftItems.some((i) => i.suggestion != null)),
  };
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
  /** Other readings of the line total (from its quantity line, or another reading of the photo). */
  alternatives: Option[];
  /** How many readings agree with the line total as it stands. */
  votes: number;
}

/** Another reading of an item's price, with its quantity line when that came with it. */
interface Option {
  lineTotal: number;
  votes: number;
  detail?: { quantity: number; unit: string; unitPrice: number };
}

/** A line another reading found and this one missed, to slot in after the item at `after` (-1: first). */
interface Extra {
  after: number;
  item: Item;
  votes: number;
}

interface Detail {
  quantity: number;
  unit: string;
  unitPrice: number;
  lineTotal: number | null;
  /**
   * Set when the unit price couldn't be read cleanly: the digits that were read ("65.49" from
   * "2865.49"), or "" when none were. The item's own total then gives the unit price.
   */
  hint?: string;
}

interface Tax {
  value: number;
  /** "TOTAL TAX" rather than one of several tax lines. */
  isTotal: boolean;
  afterTotal: boolean;
}

function newItem(receiptText: string, lineTotal: number): Item {
  return { receiptText: receiptText.trim(), quantity: 1, unit: 'pcs', unitPrice: lineTotal, lineTotal, detailed: false, alternatives: [], votes: 1 };
}

/** Does "2 @ 1.29" belong to an item whose line total is 2.58? Allows a few cents of rounding. */
function fits(detail: Detail, item: Item): boolean {
  const expected = detail.lineTotal ?? detail.quantity * detail.unitPrice;
  return Math.abs(expected - item.lineTotal) <= 0.03
    || Math.abs(detail.quantity * detail.unitPrice - item.lineTotal) <= 0.03
    // Some receipts print the unit price on the item line and the line total on the quantity line.
    || (detail.lineTotal != null && Math.abs(detail.unitPrice - item.lineTotal) < 0.015);
}

/**
 * Matches a quantity or weight line to an item, allowing for one misread digit on either side:
 * "2 @ 6.99" with 11.98 means 2 @ 5.99; "2 @ 2.29" with 4.68 means one of them is wrong, and the
 * receipt's total decides which (repairDigits).
 */
function attach(item: Item, detail: Detail): boolean {
  if (detail.hint !== undefined) {
    const unitPrice = item.lineTotal / detail.quantity;
    if (unitPrice <= 0 || !isCents(unitPrice)) return false;
    const read = priceSuffixes(detail.hint);
    const wanted = unitPrice.toFixed(2);
    if (read.length && !read.some((digits) => digits === wanted || oneDigitOff(digits, wanted))) return false;
    applyDetail(item, { quantity: detail.quantity, unit: 'pcs', unitPrice: round2(unitPrice), lineTotal: null });
    return true;
  }
  if (fits(detail, item)) {
    applyDetail(item, detail);
    return true;
  }
  if (showsUnitPrice(detail, item)) {
    applyDetail(item, { ...detail, lineTotal: round2(detail.quantity * detail.unitPrice) });
    return true;
  }
  if (detail.unit === 'pcs' && detail.quantity >= 2) {
    const unitPrice = item.lineTotal / detail.quantity;
    if (isCents(unitPrice) && oneDigitOff(unitPrice.toFixed(2), detail.unitPrice.toFixed(2))) {
      applyDetail(item, { ...detail, unitPrice: round2(unitPrice), lineTotal: null });
      return true;
    }
  }
  const expected = round2(detail.lineTotal ?? detail.quantity * detail.unitPrice);
  if (oneDigitOff(expected.toFixed(2), item.lineTotal.toFixed(2))) {
    applyDetail(item, { ...detail, lineTotal: null });
    addOption(item, { lineTotal: expected, votes: 1 });
    return true;
  }
  return false;
}

/** Whether a quantity line printed under an item is that item's: it fits, or is one digit off. */
function belongsTo(detail: Detail, item: Item): boolean {
  if (fits(detail, item) || showsUnitPrice(detail, item)) return true;
  const expected = round2(detail.lineTotal ?? detail.quantity * detail.unitPrice);
  return oneDigitOff(expected.toFixed(2), item.lineTotal.toFixed(2));
}

/** "AVOCADOS 3.49" then "2 @ 3.49  [unreadable]": the item line shows the unit price, not the total. */
function showsUnitPrice(detail: Detail, item: Item): boolean {
  return detail.hint === undefined && detail.lineTotal == null && detail.quantity >= 2 && Math.abs(detail.unitPrice - item.lineTotal) < 0.005;
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

function addOption(item: Item, option: Option): void {
  if (Math.abs(option.lineTotal - item.lineTotal) < 0.005) return;
  const same = item.alternatives.find((o) => Math.abs(o.lineTotal - option.lineTotal) < 0.005);
  if (same) {
    same.votes += option.votes;
    same.detail ??= option.detail;
  } else {
    item.alternatives.push({ ...option });
  }
}

function copyItem(item: Item): Item {
  return { ...item, alternatives: item.alternatives.map((o) => ({ ...o })) };
}

/**
 * When the lines don't add up to what the receipt says (subtotal, or total less tax), look for the
 * fewest changes that make them add up to the cent: another reading of a price, or a line another
 * reading found. Only an unambiguous fix is made (one way of doing it, or one with clearly more
 * readings behind it); otherwise the lines stay as read and the note says they don't add up.
 */
function repairDigits(items: Item[], subtotal: number | null, tax: number | null, total: number | null, extras: Extra[]): void {
  const target = subtotal ?? (total != null && tax != null ? round2(total - tax) : null);
  if (target == null) return;
  const gap = round2(target - items.reduce((sum, item) => sum + item.lineTotal, 0));
  if (Math.abs(gap) < 0.005) return;

  type Change = { item?: Item; option?: Option; extra?: Extra; delta: number; votes: number };
  const changes: Change[] = [
    ...items.flatMap((item) => item.alternatives.map((option) => ({
      item, option, delta: round2(option.lineTotal - item.lineTotal), votes: option.votes - item.votes,
    }))),
    ...extras.map((extra) => ({ extra, delta: extra.item.lineTotal, votes: extra.votes })),
  ];
  // Smallest number of changes first; at most four (two misread digits and two missed lines, say).
  for (let size = 1; size <= Math.min(4, changes.length); size++) {
    const found: Change[][] = [];
    const pick = (start: number, chosen: Change[], sum: number) => {
      if (chosen.length === size) {
        if (Math.abs(sum - gap) < 0.005) found.push([...chosen]);
        return;
      }
      for (let k = start; k < changes.length; k++) {
        const change = changes[k];
        if (change.item && chosen.some((c) => c.item === change.item)) continue; // one change per line
        chosen.push(change);
        pick(k + 1, chosen, sum + change.delta);
        chosen.pop();
      }
    };
    pick(0, [], 0);
    if (!found.length) continue;
    const support = (combo: Change[]) => combo.reduce((s, c) => s + c.votes, 0);
    found.sort((a, b) => support(b) - support(a));
    if (found.length > 1 && support(found[0]) === support(found[1])) return; // ambiguous: leave as read
    const inserts: Extra[] = [];
    for (const change of found[0]) {
      if (change.extra) {
        inserts.push(change.extra);
      } else if (change.item && change.option) {
        const { item, option } = change;
        item.lineTotal = option.lineTotal;
        if (option.detail) Object.assign(item, option.detail, { detailed: true });
        else if (!item.detailed) item.unitPrice = round3(option.lineTotal / item.quantity);
        else if (item.unit === 'pcs' && isCents(option.lineTotal / item.quantity)) item.unitPrice = round2(option.lineTotal / item.quantity);
      }
    }
    // Slot missed lines in where the other reading had them, last first so positions stay put.
    for (const extra of inserts.sort((a, b) => b.after - a.after)) items.splice(extra.after + 1, 0, extra.item);
    return;
  }
}

/** Fills in from the other readings: see bestReading. */
function combine(base: Reading, others: Reading[]): Reading {
  const items = base.items.map(copyItem);
  const extras: Extra[] = [];
  for (const other of others) {
    const pairs = align(items, other.items);
    const matched = new Set(pairs.map(([, j]) => j));
    for (const [i, j] of pairs) absorb(items[i], other.items[j]);
    other.items.forEach((item, j) => {
      if (matched.has(j)) return;
      const after = pairs.filter(([, k]) => k < j).at(-1)?.[0] ?? -1;
      const same = extras.find((e) => e.after === after && Math.abs(e.item.lineTotal - item.lineTotal) < 0.005);
      if (same) same.votes++;
      else extras.push({ after, item: { ...copyItem(item), votes: 1 }, votes: 1 });
    });
  }
  const all = [base, ...others];
  const total = majority(all.map((r) => r.total));
  const subtotal = majority(all.map((r) => r.subtotal));
  const tax = majority(all.map((r) => r.tax).filter((t) => total == null || t == null || t < total / 2));
  repairDigits(items, subtotal, tax, total, extras);
  return { lines: base.lines, header: base.header, items, subtotal, tax, total };
}

/** The same printed line in two readings: what one reading adds to the other. */
function absorb(item: Item, other: Item): void {
  if (Math.abs(other.lineTotal - item.lineTotal) < 0.005) {
    item.votes++;
    if (!item.detailed && other.detailed) Object.assign(item, { quantity: other.quantity, unit: other.unit, unitPrice: other.unitPrice, detailed: true });
  } else {
    addOption(item, {
      lineTotal: other.lineTotal,
      votes: 1,
      detail: other.detailed ? { quantity: other.quantity, unit: other.unit, unitPrice: other.unitPrice } : undefined,
    });
  }
  for (const option of other.alternatives) addOption(item, { ...option, votes: 1 });
  // Keep the cleaner reading of the name ("GREEN SDLS GRAPES" over "a OGREEN SOLS GRAPES").
  if (nameSimilarity(item.receiptText, other.receiptText) >= 0.5 && nameQuality(other.receiptText) > nameQuality(item.receiptText)) {
    item.receiptText = other.receiptText;
  }
}

/** Pairs up the items two readings share, in order (a weighted longest common subsequence). */
function align(a: Item[], b: Item[]): [number, number][] {
  const weight = (x: Item, y: Item): number => {
    const names = nameSimilarity(x.receiptText, y.receiptText);
    const samePrice = Math.abs(x.lineTotal - y.lineTotal) < 0.005;
    if (names >= 0.6 || (samePrice && names >= 0.25)) return names + (samePrice ? 0.5 : 0);
    return 0;
  };
  const best = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const w = weight(a[i - 1], b[j - 1]);
      best[i][j] = Math.max(best[i - 1][j], best[i][j - 1], w > 0 ? best[i - 1][j - 1] + w : 0);
    }
  }
  const pairs: [number, number][] = [];
  for (let i = a.length, j = b.length; i > 0 && j > 0;) {
    const w = weight(a[i - 1], b[j - 1]);
    if (w > 0 && Math.abs(best[i][j] - (best[i - 1][j - 1] + w)) < 1e-9) {
      pairs.unshift([i - 1, j - 1]);
      i--;
      j--;
    } else if (best[i - 1][j] >= best[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }
  return pairs;
}

/** Names as read: the closer of letter-by-letter similarity and the share of words they have in common. */
function nameSimilarity(a: string, b: string): number {
  const ka = aliasKey(a);
  const kb = aliasKey(b);
  if (!ka || !kb) return 0;
  const words = (k: string) => new Set(k.split(' ').filter((w) => w.length >= 3));
  const wa = words(ka);
  const wb = words(kb);
  const shared = [...wa].filter((w) => wb.has(w)).length;
  const overlap = Math.min(wa.size, wb.size) ? shared / Math.min(wa.size, wb.size) : 0;
  return Math.max(similarity(ka, kb), overlap * 0.9);
}

/** Receipts print names in capitals; lower-case letters and lone characters are usually specks. */
function nameQuality(text: string): number {
  const upper = (text.match(/[A-Z]/g) ?? []).length;
  const lower = (text.match(/[a-z]/g) ?? []).length;
  const lone = text.split(/\s+/).filter((w) => w.length === 1).length;
  return upper - 3 * lower - 2 * lone;
}

/** The value most readings agree on (the first reading's on a tie). */
function majority(values: (number | null)[]): number | null {
  let best: number | null = null;
  let bestCount = 0;
  for (const value of values) {
    if (value == null) continue;
    const count = values.filter((v) => v != null && Math.abs(v - value) < 0.005).length;
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

/** One tax line, the "TOTAL TAX" line when there is one, or the line that is the sum of the others. */
function resolveTax(taxes: Tax[]): number | null {
  const before = taxes.filter((t) => !t.afterTotal);
  const pool = before.length ? before : taxes;
  if (!pool.length) return null;
  const totalLine = pool.find((t) => t.isTotal);
  if (totalLine) return totalLine.value;
  const sum = round2(pool.reduce((s, t) => s + t.value, 0));
  if (pool.length > 2) {
    const whole = pool.find((t) => Math.abs(sum - 2 * t.value) < 0.005);
    if (whole) return whole.value;
  }
  return sum;
}

/** The value of a price printed alone on the line after `index`, if that's what's there. */
function takeLonePrice(lines: string[], index: number): number | null {
  const next = lines[index + 1];
  if (!next || letters(next) >= 2) return null;
  return trailingPrice(next)?.value ?? null;
}

/** "65.49" read where "5.49" was printed: the prices a run of digits may end with. */
function priceSuffixes(digits: string): string[] {
  const out: string[] = [];
  for (let start = 0; start < digits.length; start++) {
    const part = digits.slice(start);
    if (/^(?:0|[1-9]\d{0,2})\.\d{2}$/.test(part)) out.push(part);
  }
  return out;
}

/** Same length, exactly one character different: "4.68" and "4.58". */
function oneDigitOff(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let differences = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) differences++;
  return differences === 1;
}

function isCents(value: number): boolean {
  return Math.abs(value * 100 - Math.round(value * 100)) < 1e-6;
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
  let line = raw.replace(/[|}{[\]_~`"“”§]/g, ' ').replace(/\s+$/, '');
  // Scraps set apart by a wide gap at either end of the line: a department code before the name
  // ("WT      BANANAS"), or specks of the table or bedspread read as letters ("6.79 B      k").
  line = line.replace(/^\s*(?:[^\s\d]{1,2}\s{3,})+(?=\S)/, '');
  for (let k = 0; k < 3; k++) {
    const scrap = /\S(\s{3,})(\S{1,3})$/.exec(line); // only after other text: "TAX" alone is a line
    if (!scrap || /\d[.,]\d|[.,]\d\d/.test(scrap[2])) break;
    line = line.slice(0, scrap.index + 1);
  }
  // A price whose decimal point was too faint to read, set apart in the price column: "BREAD     599 B".
  if (letters(line) >= 3 && !/\d[.,]\s?\d{2}/.test(line)) {
    line = line.replace(/(\S\s{2,})([1-9]\d?|0)(\d{2})((?:\s[A-Z\d*]{1,2})?)$/, '$1$2.$3$4');
  }
  return line
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
    .replace(/^(?:\d{1,3}\s+)?\d{1,3}\.\d{2,3}\s+(?=[A-Za-z])/, '') // a quantity line read onto the name
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

function findStore(header: string[], lines: string[], knownStores: string[]): string | null {
  const text = header.join(' ');
  const upper = text.toUpperCase();
  const known = knownStores.find((store) => store.length >= 3 && upper.includes(store.toUpperCase()));
  if (known) return known;
  const asKnown = (name: string) => knownStores.find((s) => s.toLowerCase() === name.toLowerCase()) ?? name;
  // A chain's name in the header; then its logo, slogan or loyalty card; then its name anywhere.
  const everything = lines.join('\n');
  for (const [patterns, where] of [[CHAINS, text], [STORE_HINTS, everything], [CHAINS, everything]] as const) {
    for (const [pattern, name] of patterns) {
      if (pattern.test(where)) return asKnown(name);
    }
  }
  // Otherwise the first header line that looks like a name, not a speck. Names come above the
  // address, phone and date, so stop looking there.
  const placeOrTime = (line: string) =>
    /\d{3}[-.) ]\s*\d{3}[-. ]\d{4}/.test(line)
    || /\b(?:ST|AVE|RD|BLVD|DR|DRIVE|HWY|PIKE|SUITE|STE|LN|WAY|STREET|ROAD|AVENUE)\b\.?/i.test(line)
    || /\b\d{5}(?:-\d{4})?\b/.test(line)
    || /\b[A-Z]{2},?\s+\d{4,5}\b/.test(line)
    || /\d{1,2}[/-]\d{1,2}[/-]\d{2,4}/.test(line);
  const stop = header.findIndex(placeOrTime);
  const candidate = (stop >= 0 ? header.slice(0, stop) : header).find((line) =>
    letters(line) >= 3
    && averageWordLength(line) >= 3
    && upperShare(line) >= 0.6
    && !/\b(?:WELCOME|STORE\s*#|STORE\s+\d|MANAGER|OPEN|HOURS)\b/i.test(line));
  return candidate ? titleCase(candidate.replace(/[^A-Za-z0-9&' ]/g, ' ').replace(/\s+/g, ' ').trim()) : null;
}

/** Store names print in capitals; mixed-case header text is usually a slogan or a misread logo. */
function upperShare(line: string): number {
  const all = letters(line);
  return all ? (line.match(/[A-Z]/g) ?? []).length / all : 0;
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

/** The time printed next to the date, else one with AM/PM, else the first that looks like a time. */
function findTime(lines: string[]): string | null {
  const found: { time: string; rank: number }[] = [];
  for (const line of lines) {
    const match = /\b(\d{1,2}):(\d{2})(?::\d{2})?\s*([AP])?\.?M?\b/i.exec(line);
    if (!match) continue;
    let hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour > 23 || minute > 59) continue;
    const half = match[3]?.toUpperCase();
    if (half === 'P' && hour < 12) hour += 12;
    if (half === 'A' && hour === 12) hour = 0;
    const rank = /\d{1,2}[/-]\d{1,2}[/-]\d{2,4}/.test(line) ? 2 : half ? 1 : 0;
    found.push({ time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`, rank });
  }
  found.sort((a, b) => b.rank - a.rank);
  return found[0]?.time ?? null;
}

function notesFor(count: number, linesSum: number, tax: number | null, total: number | null, suggestions = false): string {
  if (count === 0) {
    return 'No items were found in this photo. Try a sharper, flatter photo in good light, or add the lines by hand.';
  }
  const base = 'Read on this device. Check each line: names stay as printed until you fix them once, and the app remembers your fixes.';
  if (total != null && Math.abs(linesSum + (tax ?? 0) - total) > 0.05) {
    const hint = suggestions ? ' Lines marked “Also read as” were read two ways; the other reading is often the right one.' : '';
    return `${base} The lines don't add up to the receipt total yet, so a line may be missing or misread.${hint}`;
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
