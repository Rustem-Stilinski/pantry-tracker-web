import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Observable, of } from 'rxjs';

import { Api } from '../core/api.service';
import { ItemBarcode, ItemHistory, ReceiptDetail } from '../core/models';
import { Session } from '../core/session.service';
import { Toasts } from '../core/toast.service';
import { ItemPage } from './item.page';
import { ReceiptPage } from './receipt.page';

// The price chart sizes itself with ResizeObserver, which jsdom doesn't have.
class NoResize {
  observe(): void {}
  disconnect(): void {}
}

const HISTORY: ItemHistory = {
  summary: {
    itemKey: 'fairlife 2% milk', itemName: 'Fairlife 2% milk', unit: 'pcs', category: 'Dairy & eggs',
    latestPrice: 5.49, latestStore: 'Wegmans', latestAt: '2026-10-18T16:38:00Z', changePercent: null,
    lowestPrice: 5.49, lowestStore: 'Wegmans', lowestAt: '2026-10-18T16:38:00Z', averagePrice: 5.49, purchases: 1, storeCount: 1,
  },
  stores: [{ storeName: 'Wegmans', latestPrice: 5.49, latestAt: '2026-10-18T16:38:00Z', lowestPrice: 5.49, purchases: 1 }],
  points: [{ receiptId: 'r1', purchasedAt: '2026-10-18T16:38:00Z', storeName: 'Wegmans', storeLocation: null, quantity: 2, unitPrice: 5.49, lineTotal: 10.98 }],
};

const RECEIPT: ReceiptDetail = {
  id: 'r1', storeName: 'Wegmans', storeLocation: '11620 Monument Drive, Fairfax, VA 22030',
  purchasedAt: new Date(2026, 9, 1, 12, 38).toISOString(), subtotal: 5.49, tax: 0.05, total: 5.54, createdBy: 'u1',
  items: [{ id: 'l1', name: 'Fairlife 2% milk', receiptText: 'FAIRLIFE 2% MILK', quantity: 1, unit: 'pcs', unitPrice: 5.49, lineTotal: 5.49, category: 'Dairy & eggs' }],
  priceChanges: [],
};

describe('an item’s UPCs and a receipt’s date', () => {
  let barcodes: ItemBarcode[];
  let calls: string[];
  let toasts: { message: string; undo?: () => void }[];

  beforeEach(async () => {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= NoResize;
    calls = [];
    toasts = [];
    barcodes = [
      { code: '0036000291452', itemName: 'Fairlife 2% milk' },
      { code: '4006381333931', itemName: 'fairlife 2% MILK' },
    ];
    const api: Partial<Api> = {
      priceHistory: () => of(HISTORY),
      itemBarcodes: (_h: string, item: string) => {
        calls.push(`list ${item}`);
        return of([...barcodes]);
      },
      unlinkBarcode: (_h: string, code: string): Observable<void> => {
        calls.push(`unlink ${code}`);
        barcodes = barcodes.filter((b) => b.code !== code);
        return of(undefined);
      },
      saveBarcode: (_h: string, code: string, itemName: string) => {
        calls.push(`save ${code} ${itemName}`);
        barcodes.push({ code, itemName });
        return of({ code, known: true, itemName, suggestion: null, prices: null });
      },
      receipt: () => of(RECEIPT),
      changeReceiptDate: (_h: string, id: string, purchasedAt: string) => {
        calls.push(`date ${id} ${purchasedAt}`);
        return of({ ...RECEIPT, purchasedAt });
      },
    };
    await TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: Api, useValue: api },
        { provide: Session, useValue: { activeHouseholdId: signal('h1') } },
        { provide: Toasts, useValue: { show: (message: string, undo?: () => void) => toasts.push({ message, undo }) } },
      ],
    }).compileComponents();
  });

  it('shows the item’s UPCs and a scan link that links new ones to it', async () => {
    const fixture = TestBed.createComponent(ItemPage);
    fixture.componentRef.setInput('item', 'Fairlife 2% milk');
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    expect(calls).toContain('list Fairlife 2% milk');
    const chips = [...el.querySelectorAll('.upc-chip')].map(
      (c) => `${c.querySelector('.label-caps')?.textContent?.trim()} ${c.querySelector('code')?.textContent?.trim()}`,
    );
    expect(chips).toEqual(['UPC 0 36000 29145 2', 'EAN 4 006381 333931']);
    const scan = [...el.querySelectorAll('a')].find((a) => a.textContent?.includes('Scan another UPC'));
    expect(scan?.getAttribute('href')).toBe('/scan?for=Fairlife%202%25%20milk');
  });

  it('removes a wrong UPC, with Undo', async () => {
    const fixture = TestBed.createComponent(ItemPage);
    fixture.componentRef.setInput('item', 'Fairlife 2% milk');
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    (el.querySelector('[aria-label="Remove EAN 4 006381 333931"]') as HTMLButtonElement).click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(calls).toContain('unlink 4006381333931');
    expect(el.querySelectorAll('.upc-chip').length).toBe(1);
    expect(toasts.at(-1)?.message).toBe('Removed EAN 4 006381 333931');

    toasts.at(-1)!.undo!();
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(calls).toContain('save 4006381333931 fairlife 2% MILK');
    expect(el.querySelectorAll('.upc-chip').length).toBe(2);
  });

  it('offers to scan a UPC when the item has none', async () => {
    barcodes = [];
    const fixture = TestBed.createComponent(ItemPage);
    fixture.componentRef.setInput('item', 'Fairlife 2% milk');
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.upc-row')?.textContent).toContain('No UPC linked yet');
    expect([...el.querySelectorAll('a')].some((a) => a.textContent?.trim() === 'Scan its UPC')).toBe(true);
  });

  it('corrects a receipt’s date', async () => {
    const fixture = TestBed.createComponent(ReceiptPage);
    fixture.componentRef.setInput('id', 'r1');
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.item-head .label-caps')?.textContent).toContain('Oct 1');

    [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Wrong date? Change it'))!.click();
    fixture.detectChanges();
    const date = el.querySelector('#fix-date') as HTMLInputElement;
    const time = el.querySelector('#fix-time') as HTMLInputElement;
    expect(date.value).toBe('2026-10-01');
    expect(time.value).toBe('12:38');

    date.value = '2026-11-01';
    date.dispatchEvent(new Event('input'));
    (el.querySelector('form.date-fix') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(calls).toContain(`date r1 ${new Date(2026, 10, 1, 12, 38).toISOString()}`);
    expect(el.querySelector('.item-head .label-caps')?.textContent).toContain('Nov 1');
    expect(el.querySelector('form.date-fix')).toBeNull();
    expect(toasts.at(-1)?.message).toBe('Date changed. It’s now under November 2026 in Receipts.');
  });

  it('won’t move a receipt into the future', async () => {
    const fixture = TestBed.createComponent(ReceiptPage);
    fixture.componentRef.setInput('id', 'r1');
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Wrong date? Change it'))!.click();
    fixture.detectChanges();
    const date = el.querySelector('#fix-date') as HTMLInputElement;
    date.value = '2999-01-01';
    date.dispatchEvent(new Event('input'));
    (el.querySelector('form.date-fix') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(calls.some((c) => c.startsWith('date'))).toBe(false);
    expect(el.querySelector('.date-fix .form-msg')?.textContent).toContain('hasn’t happened yet');
  });
});
