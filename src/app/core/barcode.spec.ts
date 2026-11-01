import { pickBarcode } from '../scan/barcode-reader';
import { ReadConfirmer, barcodeLabel, closestItems, displayBarcode, sameBarcode, typedBarcode, typedBarcodeProblem } from './barcode';

describe('typed barcodes', () => {
  it('keeps the digits of a product barcode, however it was spaced', () => {
    expect(typedBarcode('0 36000 29145 2')).toBe('036000291452');
    expect(typedBarcode('0-036000-291452')).toBe('0036000291452');
    expect(typedBarcode('9638 5074')).toBe('96385074');
  });

  it('refuses what can’t be a product barcode', () => {
    expect(typedBarcode('12345')).toBeNull();
    expect(typedBarcode('0360002914')).toBeNull();
    expect(typedBarcode('03600029145x')).toBeNull();
    expect(typedBarcode('')).toBeNull();
  });

  it('takes dots and dashes as spacing', () => {
    expect(typedBarcode('0.36000.29145.2')).toBe('036000291452');
    expect(typedBarcode('0–36000–29145–2')).toBe('036000291452');
  });

  it('says what to fix when a typed number can’t be a barcode', () => {
    // The usual slip: only the big digits, without the small ones at each end.
    expect(typedBarcodeProblem('36000 29145')).toBe(
      'That’s 10 digits. A UPC has 12: include the small digits printed outside the bars at each end, like 0 36000 29145 2.');
    expect(typedBarcodeProblem('0 36000 29145')).toContain('That’s 11 digits. A UPC has 12');
    expect(typedBarcodeProblem('4011')).toContain('That’s 4 digits.');
    expect(typedBarcodeProblem('4011')).toContain('stickers on fruit');
    expect(typedBarcodeProblem('')).toBe('Type the numbers printed under the bars.');
    expect(typedBarcodeProblem('fairlife')).toBe('Use only the numbers printed under the bars.');
    expect(typedBarcodeProblem('0 36000 29145 2 0 36000 29145 2')).toContain('more than a barcode has');
    // Never guesses a missing digit.
    expect(typedBarcode('36000 29145 2')).toBeNull();
  });

  it('knows a UPC-A and its EAN-13 are the same code', () => {
    expect(sameBarcode('036000291452', '0036000291452')).toBe(true);
    expect(sameBarcode('0036000291452', '036000291452')).toBe(true);
    expect(sameBarcode('036000291452', '4006381333931')).toBe(false);
  });

  it('spaces codes the way they are printed, UPCs as 12 digits', () => {
    expect(displayBarcode('0036000291452')).toBe('0 36000 29145 2');
    expect(barcodeLabel('0036000291452')).toBe('UPC');
    expect(displayBarcode('4006381333931')).toBe('4 006381 333931');
    expect(barcodeLabel('4006381333931')).toBe('EAN');
    expect(displayBarcode('96385074')).toBe('9638 5074');
    expect(displayBarcode('10012345678902')).toBe('10012345678902');
  });
});

describe('reading from the camera', () => {
  it('takes the first product barcode and ignores other kinds', () => {
    expect(pickBarcode([
      { rawValue: 'https://example.com', format: 'qr_code' },
      { rawValue: '036000291452', format: 'upc_a' },
    ])).toEqual({ code: '036000291452', format: 'upc_a' });
    expect(pickBarcode([{ rawValue: 'ABC-123', format: 'code_128' }])).toBeNull();
    expect(pickBarcode([])).toBeNull();
  });

  it('needs the same code on two frames in a row', () => {
    const confirm = new ReadConfirmer();
    expect(confirm.read('ean_13:4006381333931', 1000)).toBeNull();
    expect(confirm.read('ean_13:4006381333931', 1100)).toBe('ean_13:4006381333931');
  });

  it('starts over when a different code or a long gap comes between', () => {
    const confirm = new ReadConfirmer();
    confirm.read('upc_a:036000291452', 1000);
    expect(confirm.read('upc_a:036000291453', 1100)).toBeNull();
    expect(confirm.read('upc_a:036000291452', 1200)).toBeNull();
    expect(confirm.read('upc_a:036000291452', 5000)).toBeNull();
    expect(confirm.read('upc_a:036000291452', 5100)).toBe('upc_a:036000291452');
  });
});

describe('matching a product to the log’s items', () => {
  const names = ['Fairlife 2% milk', '2% Milk', 'Oat milk', 'Bananas', 'Paper towels', 'fairlife 2% MILK'];

  it('finds receipt names that share words with the product', () => {
    expect(closestItems('Fairlife 2% Reduced Fat Ultra-Filtered Milk, 52 fl oz', names)).toEqual([
      'Fairlife 2% milk', '2% Milk', 'Oat milk',
    ]);
  });

  it('ignores sizes and filler words', () => {
    expect(closestItems('Bananas, 1 lb', names)).toEqual(['Bananas']);
    expect(closestItems('The Original Value Pack, 12 ct', names)).toEqual([]);
    expect(closestItems('', names)).toEqual([]);
  });
});
