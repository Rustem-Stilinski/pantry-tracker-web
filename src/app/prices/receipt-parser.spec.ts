import { aliasKey, bestReading, categoryFor, matchAlias, parseReceiptText } from './receipt-parser';

const TODAY = new Date(2026, 9, 26);

/** Grocery layout: item lines with tax flags, weight and quantity lines, a coupon, payment after total. */
const GIANT = `
GIANT
FOOD
Store #0312   (703) 555-0142
4500 Lee Hwy, Arlington VA 22207
GNT LG EGGS 12CT              3.49 F
BANANAS                       1.36 F
  2.31 lb @ 0.59 /lb
GV 2% MLK GAL                 3.98 F
COKE 12PK                    13.98 T
  2 @ 6.99
  BONUS CARD SAVINGS          2.00-
JASMINE RICE 20LB 0000041234 21.99 F
BOTTLE DEPOSIT                0.60
SUBTOTAL                     43.40
TAX                           0.78
**** TOTAL                   44.18
VISA                         44.18
CHANGE DUE                    0.00
10/24/26  2:05 PM  REG 4 TRANS 2231
THANK YOU FOR SHOPPING
`;

/** Warehouse layout: leading flag and item number, quantity line before its item, ISO date. */
const COSTCO = `
COSTCO WHOLESALE
Pentagon City #1205
E 1234567 KS WATER 40PK        4.99 A
E 98765 ORG SPINACH            5.49
3 @ 2.49
E 55501 AVOCADOS               7.47
SUBTOTAL                      17.95
TAX                            0.00
TOTAL                         17.95
2026-10-20 18:42
`;

describe('parseReceiptText', () => {
  it('reads a grocery receipt', () => {
    const draft = parseReceiptText(GIANT, { today: TODAY });
    expect(draft.storeName).toBe('Giant');
    expect(draft.purchaseDate).toBe('2026-10-24');
    expect(draft.purchaseTime).toBe('14:05');
    expect(draft.subtotal).toBe(43.4);
    expect(draft.tax).toBe(0.78);
    expect(draft.total).toBe(44.18);

    const names = draft.items.map((i) => i.receiptText);
    expect(names).toEqual(['GNT LG EGGS 12CT', 'BANANAS', 'GV 2% MLK GAL', 'COKE 12PK', 'JASMINE RICE 20LB', 'BOTTLE DEPOSIT']);

    const bananas = draft.items[1];
    expect(bananas).toMatchObject({ quantity: 2.31, unit: 'lb', unitPrice: 0.59, lineTotal: 1.36, category: 'Produce' });

    const coke = draft.items[3];
    expect(coke).toMatchObject({ quantity: 2, unit: 'pcs', unitPrice: 5.99, lineTotal: 11.98, category: 'Drinks' });

    expect(draft.items[0]).toMatchObject({ name: 'Gnt lg eggs 12ct', category: 'Dairy & eggs', lineTotal: 3.49 });
    expect(draft.items[5].category).toBe('Other');

    // 3.49 + 1.36 + 3.98 + 11.98 + 21.99 + 0.60 = 43.40, the printed subtotal.
    const sum = draft.items.reduce((s, i) => s + i.lineTotal, 0);
    expect(Math.round(sum * 100) / 100).toBe(43.4);
    expect(draft.notes).not.toContain("don't add up");
  });

  it('reads a warehouse receipt with item numbers and a quantity line before its item', () => {
    const draft = parseReceiptText(COSTCO, { today: TODAY });
    expect(draft.storeName).toBe('Costco');
    expect(draft.purchaseDate).toBe('2026-10-20');
    expect(draft.purchaseTime).toBe('18:42');
    expect(draft.items.map((i) => i.receiptText)).toEqual(['KS WATER 40PK', 'ORG SPINACH', 'AVOCADOS']);
    expect(draft.items[2]).toMatchObject({ quantity: 3, unitPrice: 2.49, lineTotal: 7.47, category: 'Produce' });
  });

  it('uses learned names and known stores', () => {
    const draft = parseReceiptText(GIANT, {
      today: TODAY,
      knownStores: ['Giant'],
      aliases: [
        { receiptText: 'GV 2% MLK GAL 3.98 F', name: 'Milk 2%, 1 gal', unit: 'pcs', category: 'Dairy & eggs' },
        // OCR misread one letter this time ("EGG5"); a close match still counts.
        { receiptText: 'GNT LG EGG5 12CT', name: 'Eggs, large, 12 ct', unit: 'pcs', category: 'Dairy & eggs' },
        { receiptText: 'BANANAS', name: 'Bananas', unit: 'pcs', category: 'Produce' },
      ],
    });
    expect(draft.items[2].name).toBe('Milk 2%, 1 gal');
    expect(draft.items[0].name).toBe('Eggs, large, 12 ct');
    // Sold by weight on this receipt: the weight wins over the learned unit.
    expect(draft.items[1]).toMatchObject({ name: 'Bananas', unit: 'lb', quantity: 2.31 });
  });

  it('handles OCR noise: comma decimals, split prices and a name on its own line', () => {
    const draft = parseReceiptText(`
      TRADER JOE'S
      ORGANIC BANANAS 0,99
      MANDARIN ORANGE CHICKEN
      4.49
      PEANUT BUTTER 3. 49
      TOTAL 8.97
    `, { today: TODAY });
    expect(draft.storeName).toBe("Trader Joe's");
    expect(draft.items.map((i) => [i.receiptText, i.lineTotal])).toEqual([
      ['ORGANIC BANANAS', 0.99], ['MANDARIN ORANGE CHICKEN', 4.49], ['PEANUT BUTTER', 3.49],
    ]);
  });

  it('copes with letters the camera reads as digits ("lb" as "1b", a "T" flag as "1")', () => {
    // Exactly what Tesseract returned for the test photo.
    const draft = parseReceiptText(`
      GIANT
      BANANAS                   1.36 F
      2.31 1b @ 0.59 /1b
      COKE 12PK                13.98 1
      2 @6.99
      BONUS CARD SAVINGS       2.00-
      0.82 KG © 4.40/KG
      TOTAL 15.34
    `, { today: TODAY });
    expect(draft.items[0]).toMatchObject({ receiptText: 'BANANAS', quantity: 2.31, unit: 'lb', unitPrice: 0.59, lineTotal: 1.36 });
    expect(draft.items[1]).toMatchObject({ receiptText: 'COKE 12PK', quantity: 2, unitPrice: 5.99, lineTotal: 11.98 });
  });

  it('reads a quantity line that carries the line total, and a misread leading zero', () => {
    // What Tesseract returned for the tilted test photo once it was cropped.
    const draft = parseReceiptText(`
      TRADER JOE'S
      ORGANIC BANANAS           e.99
      AVOCADOS BAG 4CT          3.49
      2 @ 3.48                 6.98
      SOURDOUGH (LOAF            3.99
      SUBTOTAL                 11.96
      TOTAL                    11.96
    `, { today: TODAY });
    expect(draft.items[0]).toMatchObject({ receiptText: 'ORGANIC BANANAS', lineTotal: 0.99 });
    expect(draft.items[1]).toMatchObject({ quantity: 2, unitPrice: 3.49, lineTotal: 6.98 });
    expect(draft.items[2].name).toBe('Sourdough loaf');
    expect(draft.notes).not.toContain("don't add up");
  });

  it('handles the exact readings of both test photos', () => {
    // Tilted photo, single-block mode: "£" for 0, "(" stray, unit price misread, October as "19".
    const block = parseReceiptText(`ee\nTRADER JOE'S\n1101 § Joyce St  Arlington vA\nORGANIC BANANAS           £.99
MANDARIN ORANGE CHICKEN   4.49\nGREEK YOGURT PLAIN        5.49\nAVOCADOS BAG 4CT          3.49\n2 @ 3.48                 6.98
SOURDOUGH (LOAF            3.99\nSUBTOTAL                 21.94\nTAX                       0.00\nTOTAL                    21.94
19/22/2026  6:47 pM\na`, { today: TODAY });
    // Same photo, single-column mode: the first item's price on its own line.
    const column = parseReceiptText(`ee\nTRADER JOE'S\nORGANIC BANANAS\ne.99\nMANDARIN ORANGE CHICKEN 4.49\nGREEK YOGURT PLAIN        5.49
AVOCADOS BAG 4CT          3.49\n2 @ 3.49                 6.98\nSOURDOUGH LOAF            3.99\nSUBTOTAL                 21.94
TOTAL                    21.94\n16/22/2026  6:47 PM`, { today: TODAY });
    for (const draft of [block, column]) {
      expect(draft.storeName).toBe("Trader Joe's");
      expect(draft.purchaseDate).toBe('2026-10-22');
      expect(draft.items.map((i) => i.lineTotal)).toEqual([0.99, 4.49, 5.49, 6.98, 3.99]);
      expect(draft.items[3]).toMatchObject({ quantity: 2, unitPrice: 3.49, category: 'Produce' });
      expect(draft.items[4]).toMatchObject({ name: 'Sourdough loaf', category: 'Bakery' });
      expect(draft.notes).not.toContain("don't add up");
    }
    // Straight photo, column mode: a colon before the tax flag and an unreadable "2 @" price.
    const giant = parseReceiptText(`re pe EEE CE EE\nGIANT\nCOKE 12PK                13.98 1\n2.@6.9\nBONUS CARD SAVINGS       2.00-
JASMINE RICE 20LB        21.99:F\nTOTAL 33.97`, { today: TODAY });
    expect(giant.items[0]).toMatchObject({ quantity: 2, unitPrice: 5.99, lineTotal: 11.98 });
    expect(giant.items[1]).toMatchObject({ receiptText: 'JASMINE RICE 20LB', lineTotal: 21.99 });
  });

  it('keeps the reading that adds up to the printed totals', () => {
    const misread = 'SHOP\nCOKE 12PK 13.98 T\n2@5.9\nTOTAL 13.98';
    const good = 'SHOP\nCOKE 12PK 13.98 T\n2 @ 6.99\nTOTAL 13.98';
    const wrongTotal = 'SHOP\nCOKE 12PK 18.98 T\nTOTAL 13.98';
    const draft = bestReading([wrongTotal, misread, good], { today: TODAY });
    expect(draft.items[0]).toMatchObject({ quantity: 2, unitPrice: 6.99 });
  });

  it('flags a total that the lines do not reach', () => {
    const draft = parseReceiptText('SHOP\nMILK 3.98\nTOTAL 10.00', { today: TODAY });
    expect(draft.notes).toContain("don't add up");
  });

  it('says so when nothing looks like an item', () => {
    const draft = parseReceiptText('a blurry photo\nof a cat', { today: TODAY });
    expect(draft.items).toEqual([]);
    expect(draft.notes).toContain('No items were found');
  });

  it('ignores dates in the future', () => {
    expect(parseReceiptText('SHOP\n12/31/2026\nMILK 3.98', { today: TODAY }).purchaseDate).toBeNull();
  });
});

/**
 * Wegmans layout (invented lines): quantity and weight lines above their item, department codes
 * (WT, SC, MR) before the name, "**** BALANCE" as the total, then card lines and the tax breakdown.
 */
const WEGMANS = `
Wegmans
Every day you get our best!
100 MAIN STREET
ANYTOWN, VA 22000
(555) 555-0100
10/18/26  OP# 123456
          WB SOURDOUGH BREAD       5.99 B
          WB LARGE EGGS            1.69 B
 2 @ 5.49
          FAIRLIFE 2% MILK        10.98 B
          WB BATH 12 ROLL         11.99 T
 2.49 lb @ 0.49 /lb
WT        BANANAS                  1.22 B
 3 @ 3.49
          WB MICRO ASPARAGUS      10.47 B
 1.98 lb @ 3.29 /lb
WT        GREEN SDLS GRAPES        6.51 B
 3 @ 0.05
MR        CHKOUT BAG CHARGE        0.15 T
          TAX                      1.10
     **** BALANCE                 50.10
MASTERCARD PURCHASE
CARD NUMBER: ************0000 H
AUTH: 000000  RCPT: 00000
VERIFIED BY PIN
          CREDIT CARD             50.10
          CHANGE                   0.00
VA 6% Sales Tax                    0.73
VA 1.0% SALES TAX                  0.37
TOTAL TAX                          1.10
10/18/26 12:38pm
SHOPPERS CLUB WOULD HAVE SAVED $0.80
`;

describe('Wegmans receipts', () => {
  it('reads the layout: codes, quantity lines above items, BALANCE, card lines and tax breakdown', () => {
    const draft = parseReceiptText(WEGMANS, { today: TODAY });
    expect(draft.storeName).toBe('Wegmans');
    expect(draft.purchaseDate).toBe('2026-10-18');
    expect(draft.purchaseTime).toBe('12:38');
    expect(draft.tax).toBe(1.1);
    expect(draft.total).toBe(50.1);
    expect(draft.items.map((i) => i.receiptText)).toEqual([
      'WB SOURDOUGH BREAD', 'WB LARGE EGGS', 'FAIRLIFE 2% MILK', 'WB BATH 12 ROLL', 'BANANAS',
      'WB MICRO ASPARAGUS', 'GREEN SDLS GRAPES', 'CHKOUT BAG CHARGE',
    ]);
    expect(draft.items[2]).toMatchObject({ quantity: 2, unit: 'pcs', unitPrice: 5.49, lineTotal: 10.98 });
    expect(draft.items[4]).toMatchObject({ quantity: 2.49, unit: 'lb', unitPrice: 0.49, lineTotal: 1.22 });
    expect(draft.items[5]).toMatchObject({ quantity: 3, unitPrice: 3.49, lineTotal: 10.47 });
    expect(draft.items[7]).toMatchObject({ quantity: 3, unitPrice: 0.05, lineTotal: 0.15 });
    // The "would have saved" line is not a discount, and nothing after the card lines is an item.
    expect(draft.notes).not.toContain("don't add up");
  });

  it('copes with what a dim, curled photo of one gives', () => {
    // The kinds of slips Tesseract made on a real photo: a script logo misread, "@" read as "8",
    // a lost decimal point, "B" read as "8b", specks at the line ends, the amounts of TAX and
    // BALANCE on the line above their labels.
    const draft = parseReceiptText(`
f   egrnans
    Every day you get cur best!
10/18/26  OP$ 123456
f                     WB SOURDOUGH BREAD     599 8
          WB LARGE EGGS            1.69 B          k
2865.49
          FAIRLIFE 2% MILK        10,98 B
          WB BATH 12 ROLL         11.99 1
2.49 1b @ 0.49 /1b
ut        BANANAS                  1.228
383.49
          WB MICRO ASPARAGUS      10.47 B
1.98 lb @ 3.29 /lb
wT        GREEN SDLS GRAPES        6.61 8b
3 8 0.05
HR        CHKOUT BAG CHARGE        0.15 T
                                   1.10
          TAX
                                  50.10
x¥x% BALANCE
HASTERCARD PURCHASE
SHOPPERS CLUB WOULD HAVE SAVED $0.80
`, { today: TODAY });
    expect(draft.storeName).toBe('Wegmans');
    expect(draft.items.map((i) => [i.receiptText, i.lineTotal])).toEqual([
      ['WB SOURDOUGH BREAD', 5.99], ['WB LARGE EGGS', 1.69], ['FAIRLIFE 2% MILK', 10.98], ['WB BATH 12 ROLL', 11.99],
      ['BANANAS', 1.22], ['WB MICRO ASPARAGUS', 10.47], ['GREEN SDLS GRAPES', 6.51], ['CHKOUT BAG CHARGE', 0.15],
    ]);
    expect(draft.items[2]).toMatchObject({ quantity: 2, unitPrice: 5.49 });
    expect(draft.items[5]).toMatchObject({ quantity: 3, unitPrice: 3.49 });
    expect(draft.items[7]).toMatchObject({ quantity: 3, unitPrice: 0.05 });
    expect(draft.tax).toBe(1.1);
    expect(draft.total).toBe(50.1);
    // 6.61 was a misread: the weight line (1.98 lb × 3.29) and the total both say 6.51.
    expect(draft.notes).not.toContain("don't add up");
  });

  it('offers the other reading of a price when the lines still do not add up', () => {
    const draft = parseReceiptText(`
WEGMANS
1.98 lb @ 3.29 /lb
WT        GREEN SDLS GRAPES        6.61 B
          GOYA BLK BEAN SOUP       4.68 B
          TAX                      0.00
     **** BALANCE                 11.09
`, { today: TODAY });
    // Fixing the grapes alone leaves 10 cents: no unambiguous fix, so the lines stay as read…
    expect(draft.items.map((i) => i.lineTotal)).toEqual([6.61, 4.68]);
    expect(draft.notes).toContain("don't add up");
    // …and the grapes line points at what its weight line works out to.
    expect(draft.items[0].suggestion).toBe(6.51);
    expect(draft.items[1].suggestion).toBeUndefined();
  });
});

describe('combining readings', () => {
  it('fills a line one reading missed and picks the price that makes the receipt add up', () => {
    // Each layout mode misses or misreads something different.
    const block = `GIANT
GNT LG EGGS 12CT              3.49 F
GV 2% MLK GAL                 3.98 F
COKE 12PK                    18.98 T
2 @ 6.99
SUBTOTAL                     22.81
TOTAL                        22.81`;
    const column = `GIANT
GV 2% MLK GAL                 3.98 F
COKE 12PK                    13.98 T
2 @ 6.99
BANANAS                       1.36 F
TOTAL                        22.81`;
    const draft = bestReading([block, column], { today: TODAY });
    expect(draft.items.map((i) => [i.receiptText, i.lineTotal])).toEqual([
      ['GNT LG EGGS 12CT', 3.49], ['GV 2% MLK GAL', 3.98], ['COKE 12PK', 13.98], ['BANANAS', 1.36],
    ]);
    expect(draft.items[2]).toMatchObject({ quantity: 2, unitPrice: 6.99 });
    expect(draft.notes).not.toContain("don't add up");
  });

  it('leaves the best reading alone when no single fix makes it add up', () => {
    const a = 'SHOP\nMILK 3.98\nBREAD 2.49\nTOTAL 10.00';
    const b = 'SHOP\nMILK 3.98\nBREAD 2.49\nTOTAL 10.00';
    const draft = bestReading([a, b], { today: TODAY });
    expect(draft.items.map((i) => i.lineTotal)).toEqual([3.98, 2.49]);
    expect(draft.notes).toContain("don't add up");
  });
});

describe('aliases and categories', () => {
  it('compares printed lines without prices, codes or spacing', () => {
    expect(aliasKey('GV 2% MLK GAL      3.98 F')).toBe('GV 2% MLK GAL');
    expect(aliasKey('gv 2%  mlk gal')).toBe('GV 2% MLK GAL');
    expect(aliasKey('JASMINE RICE 20LB 0000041234')).toBe('JASMINE RICE 20LB');
  });

  it('does not match unrelated short lines', () => {
    expect(matchAlias('TEA', [{ receiptText: 'TEE', name: 'Tee', unit: 'pcs', category: 'Other' }])).toBeNull();
  });

  it('guesses categories from common words', () => {
    expect(categoryFor('BNLS CHICKEN BREAST')).toBe('Meat & seafood');
    expect(categoryFor('BOUNTY PAPER TOWEL 6')).toBe('Household');
    expect(categoryFor('SOMETHING ELSE')).toBe('Other');
  });
});
