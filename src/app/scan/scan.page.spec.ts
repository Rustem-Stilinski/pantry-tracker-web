import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Observable, of, throwError } from 'rxjs';

import { Api } from '../core/api.service';
import { BarcodeLookup, ItemPrice } from '../core/models';
import { Session } from '../core/session.service';
import { ScanPage } from './scan.page';

const MILK_PRICES: ItemPrice = {
  itemKey: 'fairlife 2% milk', itemName: 'Fairlife 2% milk', unit: 'pcs', category: 'Dairy & eggs',
  latestPrice: 5.49, latestStore: 'Wegmans', latestAt: '2026-10-18T16:38:00Z', changePercent: 12.3,
  lowestPrice: 4.89, lowestStore: 'Aldi', lowestAt: '2026-10-09T16:00:00Z',
  averagePrice: 5.19, purchases: 2, storeCount: 2,
};

describe('ScanPage', () => {
  let lookups: Record<string, BarcodeLookup | Error>;
  let saved: { code: string; itemName: string }[];
  let asked: { code: string; format?: string }[];

  beforeEach(async () => {
    saved = [];
    asked = [];
    lookups = {};
    const api: Partial<Api> = {
      barcode: (_h: string, code: string, format?: string): Observable<BarcodeLookup> => {
        asked.push({ code, format });
        const answer = lookups[code];
        return answer instanceof Error ? throwError(() => answer) : of(answer);
      },
      saveBarcode: (_h: string, code: string, itemName: string) => {
        saved.push({ code, itemName });
        return of({ code, known: true, itemName, suggestion: null, prices: MILK_PRICES });
      },
      prices: () => of({ changes: [], items: [MILK_PRICES, { ...MILK_PRICES, itemKey: 'oat milk', itemName: 'Oat milk' }] }),
      frequent: () => of([{ itemName: 'Paper towels', quantity: 1, unit: 'roll', category: 'Kitchen', timesUsed: 4, lastUsedAt: '2026-10-30T12:00:00Z' }]),
    };
    await TestBed.configureTestingModule({
      imports: [ScanPage],
      providers: [
        provideRouter([]),
        { provide: Api, useValue: api },
        { provide: Session, useValue: { user: signal({ id: 'u1', email: 'a@b.c', displayName: 'Rustem' }), activeHouseholdId: signal('h1'), signOut: async () => undefined } },
      ],
    }).compileComponents();
  });

  async function render(code: string, format?: string, linkTo?: string) {
    const fixture = TestBed.createComponent(ScanPage);
    fixture.componentRef.setInput('code', code);
    if (format) fixture.componentRef.setInput('format', format);
    if (linkTo) fixture.componentRef.setInput('for', linkTo);
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('shows a known barcode’s item, its prices and a one-tap log link', async () => {
    lookups['036000291452'] = { code: '0036000291452', known: true, itemName: 'Fairlife 2% milk', suggestion: null, prices: MILK_PRICES };
    const { el } = await render('036000291452', 'upc_a');

    expect(asked).toEqual([{ code: '036000291452', format: 'upc_a' }]);
    expect(el.querySelector('.scan-name')?.textContent).toContain('Fairlife 2% milk');
    expect(el.querySelector('.barcode-digits')?.textContent).toContain('UPC 0 36000 29145 2');
    const stats = el.querySelector('.stat-row')?.textContent ?? '';
    expect(stats).toContain('$5.49 each');
    expect(stats).toContain('Wegmans');
    expect(stats).toContain('$4.89 each');
    expect(stats).toContain('Aldi');
    expect(stats).toContain('Cheapest');
    const logLink = [...el.querySelectorAll('a')].find((a) => a.textContent?.includes('Log a use'));
    expect(logLink?.getAttribute('href')).toBe('/?item=Fairlife%202%25%20milk');
  });

  it('says so when a known item has no receipt prices yet', async () => {
    lookups['4006381333931'] = { code: '4006381333931', known: true, itemName: 'Dish soap', suggestion: null, prices: null };
    const { el } = await render('4006381333931');
    expect(el.querySelector('.stat-row')).toBeNull();
    expect(el.textContent).toContain('No receipt has “Dish soap” on it yet');
  });

  it('names a new barcode, offering the suggestion and matching receipt items', async () => {
    lookups['0036000291452'] = {
      code: '0036000291452', known: false, itemName: null, prices: null,
      suggestion: { name: 'Fairlife 2% Reduced Fat Milk, 52 fl oz', brand: 'Fairlife', size: '52 fl oz', source: 'Open Food Facts' },
    };
    const { fixture, el } = await render('0036000291452');

    expect(el.querySelector('h2')?.textContent).toContain('New barcode');
    const input = el.querySelector('#barcode-name') as HTMLInputElement;
    expect(input.value).toBe('Fairlife 2% Reduced Fat Milk, 52 fl oz');
    const receiptChoices = [...el.querySelectorAll('.suggest .chips .filter')].map((b) => b.textContent?.trim());
    expect(receiptChoices).toEqual(['Fairlife 2% milk', 'Oat milk']);

    (el.querySelectorAll('.suggest .chips .filter')[0] as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(input.value).toBe('Fairlife 2% milk');

    (el.querySelector('form.name-form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(saved).toEqual([{ code: '0036000291452', itemName: 'Fairlife 2% milk' }]);
    expect(el.querySelector('.scan-name')?.textContent).toContain('Fairlife 2% milk');
    expect(el.querySelector('.stat-row')?.textContent).toContain('$5.49 each');
  });

  it('asks for a name before saving', async () => {
    lookups['96385074'] = { code: '96385074', known: false, itemName: null, prices: null, suggestion: null };
    const { fixture, el } = await render('96385074');
    expect((el.querySelector('#barcode-name') as HTMLInputElement).value).toBe('');
    (el.querySelector('form.name-form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(saved).toEqual([]);
    expect(el.querySelector('.form-msg')?.textContent).toContain('Name the item');
  });

  it('shows the server’s reason when a code is refused', async () => {
    lookups['036000291453'] = Object.assign(new Error('bad'), {
      status: 400, error: { detail: 'That isn’t a product barcode number. Check the digits under the bars and try again.' },
    });
    const { el } = await render('036000291453');
    expect(el.querySelector('.form-msg')?.textContent).toContain('isn’t a product barcode');
    expect([...el.querySelectorAll('button')].some((b) => b.textContent?.includes('Scan again'))).toBe(true);
  });

  describe('scanned from an item’s page', () => {
    it('links a new UPC straight to the item, without a naming step', async () => {
      lookups['036000291452'] = { code: '0036000291452', known: false, itemName: null, prices: null, suggestion: null };
      const { el } = await render('036000291452', 'upc_a', 'Fairlife 2% milk');
      expect(saved).toEqual([{ code: '0036000291452', itemName: 'Fairlife 2% milk' }]);
      expect(el.querySelector('h2')?.textContent).toContain('UPC linked');
      expect(el.querySelector('.scan-linked')?.textContent).toContain('Linked to Fairlife 2% milk');
      expect(el.querySelector('.stat-row')?.textContent).toContain('$5.49 each');
      expect(el.querySelector('#barcode-name')).toBeNull();
    });

    it('says so when the UPC is already this item’s', async () => {
      lookups['0036000291452'] = { code: '0036000291452', known: true, itemName: 'fairlife 2% MILK', suggestion: null, prices: MILK_PRICES };
      const { el } = await render('0036000291452', undefined, 'Fairlife 2% milk');
      expect(saved).toEqual([]);
      expect(el.querySelector('.scan-linked')?.textContent).toContain('Already linked to this item');
    });

    it('asks before moving a UPC that belongs to another item', async () => {
      lookups['0036000291452'] = { code: '0036000291452', known: true, itemName: 'Oat milk', suggestion: null, prices: null };
      const { fixture, el } = await render('0036000291452', undefined, 'Fairlife 2% milk');
      expect(saved).toEqual([]);
      expect(el.querySelector('h2')?.textContent).toContain('Already linked');
      expect(el.querySelector('.scan-name')?.textContent).toContain('Oat milk');

      const move = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Link it to Fairlife 2% milk instead'));
      move!.click();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(saved).toEqual([{ code: '0036000291452', itemName: 'Fairlife 2% milk' }]);
      expect(el.querySelector('.scan-name')?.textContent).toContain('Fairlife 2% milk');
      expect(el.querySelector('.scan-linked')?.textContent).toContain('Moved here from Oat milk');
    });

    it('keeps the other item when asked to', async () => {
      lookups['0036000291452'] = { code: '0036000291452', known: true, itemName: 'Oat milk', suggestion: null, prices: null };
      const { fixture, el } = await render('0036000291452', undefined, 'Fairlife 2% milk');
      [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Keep it')!.click();
      fixture.detectChanges();
      expect(saved).toEqual([]);
      expect(el.querySelector('.scan-name')?.textContent).toContain('Oat milk');
      expect(el.textContent).toContain('No receipt has “Oat milk” on it yet');
    });
  });

  it('says when a receipt’s code linked the barcode', async () => {
    lookups['021130505043'] = {
      code: '0021130505043', known: true, itemName: 'Fairlife 2% milk', suggestion: null, prices: MILK_PRICES,
      receiptCode: '2113050504',
    };
    const { el } = await render('021130505043', 'upc_a');
    expect(el.querySelector('h2')?.textContent).toContain('UPC linked');
    expect(el.querySelector('.scan-linked')?.textContent).toContain('Found on your receipt as 21130 50504');
    expect(el.querySelector('.barcode-digits')?.textContent).toContain('UPC 0 21130 50504 3');
  });
});

