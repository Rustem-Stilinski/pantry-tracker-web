import {
  amount, errorMessage, groupByDay, itemKey, monthKey, relativeDay, shiftMonth, tallyGroups, unitLabel,
} from './format';

describe('format helpers', () => {
  it('pluralizes count units but leaves measures alone', () => {
    expect(unitLabel(1, 'roll')).toBe('roll');
    expect(unitLabel(3, 'roll')).toBe('rolls');
    expect(unitLabel(2, 'box')).toBe('boxes');
    expect(unitLabel(2, 'kg')).toBe('kg');
    expect(unitLabel(1, 'lb')).toBe('lb');
    expect(amount(2.5, 'lb')).toBe('2.5 lbs');
    expect(amount(12, 'oz')).toBe('12 oz');
    expect(amount(4, 'cup')).toBe('4 cups');
    expect(amount(1, 'cup')).toBe('1 cup');
    expect(amount(2, 'tbsp')).toBe('2 tbsp');
    expect(amount(1.5, 'L')).toBe('1.5 L');
    expect(amount(2, 'pcs')).toBe('2 pcs');
  });

  it('builds the same item key as the server', () => {
    expect(itemKey('  Paper   Towels ')).toBe('paper towels');
  });

  it('moves between months across year boundaries', () => {
    expect(monthKey(new Date(2026, 9, 25))).toBe('2026-10');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
  });

  it('describes days relative to today', () => {
    const now = new Date(2026, 9, 25, 20, 0);
    expect(relativeDay(new Date(2026, 9, 25, 8, 0), now)).toBe('today');
    expect(relativeDay(new Date(2026, 9, 24, 23, 0), now)).toBe('yesterday');
    expect(relativeDay(new Date(2026, 9, 21, 9, 0), now)).toBe('4 days ago');
  });

  it('groups newest-first items by local day', () => {
    const items = [
      new Date(2026, 9, 25, 18), new Date(2026, 9, 25, 9), new Date(2026, 9, 23, 12),
    ];
    const groups = groupByDay(items, (d) => d);
    expect(groups.map((g) => g.key)).toEqual(['2026-10-25', '2026-10-23']);
    expect(groups[0].items.length).toBe(2);
  });

  it('splits tallies into groups of five and caps them', () => {
    expect(tallyGroups(0)).toEqual([]);
    expect(tallyGroups(7)).toEqual([5, 2]);
    expect(tallyGroups(23)).toEqual([5, 5, 5, 5]);
  });

  it('prefers the problem detail from the API', () => {
    expect(errorMessage({ status: 400, error: { detail: 'quantity must be greater than or equal to 0.01' } }, 'x'))
      .toBe('quantity must be greater than or equal to 0.01');
    expect(errorMessage({ status: 500, error: null }, 'Something went wrong.')).toBe('Something went wrong.');
    expect(errorMessage({ status: 0 }, 'x')).toContain('Can’t reach the server');
  });
});
