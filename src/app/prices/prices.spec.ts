import { money, parseAmount, percent, round2, unitPrice } from '../core/money';
import { scaledSize } from '../core/photo';
import { Row, editRow } from './add-receipt.page';
import { niceRange } from './price-chart.component';

describe('money helpers', () => {
  it('formats prices per unit', () => {
    expect(money(3.5)).toBe('$3.50');
    expect(unitPrice(3.49, 'pcs')).toBe('$3.49 each');
    expect(unitPrice(0.599, 'lb')).toBe('$0.599/lb');
    expect(unitPrice(2, 'gal')).toBe('$2.00/gal');
  });

  it('shows percent changes with a sign', () => {
    expect(percent(25.1)).toBe('+25%');
    expect(percent(-7.5)).toBe('−7.5%');
    expect(percent(3)).toBe('+3%');
  });

  it('parses what people type', () => {
    expect(parseAmount('$1,204.50')).toBe(1204.5);
    expect(parseAmount(' 3.49 ')).toBe(3.49);
    expect(parseAmount('')).toBeNaN();
    expect(round2(2.675 + 0.0001)).toBe(2.68);
  });
});

describe('editing a receipt line', () => {
  const row: Row = { id: 1, name: 'Bananas', receiptText: null, qty: '2', unit: 'lb', unitPrice: '0.59', lineTotal: '1.18', category: 'Produce', suggestion: null };

  it('recalculates the total from quantity and price', () => {
    expect(editRow(row, 'qty', '2.31').lineTotal).toBe('1.36');
    expect(editRow(row, 'unitPrice', '0.69').lineTotal).toBe('1.38');
  });

  it('recalculates the unit price from the total', () => {
    expect(editRow(row, 'lineTotal', '1.50').unitPrice).toBe('0.75');
  });

  it('leaves numbers alone while a field is half-typed', () => {
    const typing = editRow(row, 'qty', '');
    expect(typing.qty).toBe('');
    expect(typing.lineTotal).toBe('1.18');
  });
});

describe('chart scale and photo size', () => {
  it('picks round ticks around the prices', () => {
    const { lo, hi, step } = niceRange(2.79, 3.49);
    expect(lo).toBeLessThanOrEqual(2.79);
    expect(hi).toBeGreaterThanOrEqual(3.49);
    expect((hi - lo) / step).toBeLessThanOrEqual(6);
  });

  it('handles a single price', () => {
    const { lo, hi } = niceRange(3.49, 3.49);
    expect(lo).toBeLessThan(3.49);
    expect(hi).toBeGreaterThan(3.49);
  });

  it('shrinks big photos but never enlarges small ones', () => {
    expect(scaledSize(3024, 4032)).toEqual({ width: 1800, height: 2400 });
    expect(scaledSize(800, 1200)).toEqual({ width: 800, height: 1200 });
  });
});
