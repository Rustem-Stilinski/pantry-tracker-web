import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Observable, of } from 'rxjs';

import { Api } from '../core/api.service';
import { BarcodeLookup, ItemBarcode, ItemPrice } from '../core/models';
import { Session } from '../core/session.service';
import { Toasts } from '../core/toast.service';
import { UpcsPage } from './upcs.page';

function item(name: string, latestAt: string, unit = 'pcs', category = 'Pantry'): ItemPrice {
  return {
    itemKey: name.toLowerCase(), itemName: name, unit, category, latestPrice: 1, latestStore: 'Wegmans', latestAt,
    changePercent: null, lowestPrice: 1, lowestStore: 'Wegmans', lowestAt: latestAt, averagePrice: 1, purchases: 1, storeCount: 1,
  };
}

const ITEMS = [
  item('Goya black bean soup', '2026-10-18T16:38:00Z'),
  item('Fairlife 2% milk', '2026-11-01T17:38:00Z', 'pcs', 'Dairy & eggs'),
  item('Bananas', '2026-11-01T17:38:00Z', 'lb', 'Produce'),
  item('Checkout bag charge', '2026-11-01T17:38:00Z', 'pcs', 'Other'),
  item('Medium salsa', '2026-10-30T12:00:00Z'),
  item('Large eggs', '2026-10-25T12:00:00Z', 'pcs', 'Dairy & eggs'),
  item('Signature jasmine rice', '2026-10-20T12:00:00Z'),
];

describe('Link UPCs', () => {
  let linked: ItemBarcode[];
  let known: Record<string, string>;
  let saved: string[];
  let toasts: { message: string; undo?: () => void }[];

  beforeEach(async () => {
    linked = [
      { code: '0041303000000', itemName: 'large eggs', source: 'scan' },
      { code: '2113050504', itemName: 'Signature jasmine rice', source: 'receipt' },
    ];
    known = { '96385074': 'Oat milk' };
    saved = [];
    toasts = [];
    const api: Partial<Api> = {
      prices: () => of({ changes: [], items: ITEMS }),
      allBarcodes: () => of([...linked]),
      barcode: (_h: string, code: string): Observable<BarcodeLookup> => {
        const full = code.length === 12 ? `0${code}` : code;
        const name = known[full];
        return of({ code: full, known: !!name, itemName: name ?? null, suggestion: null, prices: null });
      },
      saveBarcode: (_h: string, code: string, itemName: string) => {
        saved.push(`${code} ${itemName}`);
        known[code] = itemName;
        return of({ code, known: true, itemName, suggestion: null, prices: null });
      },
      unlinkBarcode: (_h: string, code: string) => {
        saved.push(`unlink ${code}`);
        return of(undefined);
      },
    };
    await TestBed.configureTestingModule({
      imports: [UpcsPage],
      providers: [
        provideRouter([]),
        { provide: Api, useValue: api },
        { provide: Session, useValue: { activeHouseholdId: signal('h1') } },
        { provide: Toasts, useValue: { show: (message: string, undo?: () => void) => toasts.push({ message, undo }) } },
      ],
    }).compileComponents();
  });

  async function render() {
    const fixture = TestBed.createComponent(UpcsPage);
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const page = fixture.componentInstance as unknown as {
      onScan(found: { code: string; format: string }): Promise<void>;
    };
    const names = (selector: string) =>
      [...el.querySelectorAll(`${selector} .upc-item strong`)].map((s) => s.textContent?.trim());
    const settle = async () => {
      await fixture.whenStable();
      fixture.detectChanges();
    };
    return { fixture, el, page, names, settle };
  }

  function press(el: HTMLElement, label: string): void {
    const button = [...el.querySelectorAll('button')].find((b) => b.textContent?.trim().startsWith(label)
      || b.getAttribute('aria-label') === label);
    if (!button) throw new Error(`no button "${label}"`);
    button.click();
  }

  it('lists items without a UPC, newest first, leaving out weighed items and fees', async () => {
    const { el, names } = await render();
    expect(names('[aria-labelledby="unlinked-title"]')).toEqual(['Fairlife 2% milk', 'Medium salsa', 'Goya black bean soup']);
    expect(names('[aria-labelledby="linked-title"]')).toEqual(['Large eggs', 'Signature jasmine rice']);
    expect(el.querySelector('#unlinked-title')?.textContent).toContain('3 without a UPC');
    const codes = [...el.querySelectorAll('.upc-codes code')].map((c) => c.textContent?.trim());
    expect(codes).toEqual(['0 41303 00000 0', '21130 50504 on receipt']);
  });

  it('links one item after another, the next ready straight away', async () => {
    const { el, page, names, settle } = await render();
    press(el, 'Scan the UPC of Fairlife 2% milk');
    await settle();
    expect(el.querySelector('.link-target .scan-name')?.textContent).toBe('Fairlife 2% milk');

    await page.onScan({ code: '036000291452', format: 'upc_a' });
    await settle();
    expect(saved).toEqual(['0036000291452 Fairlife 2% milk']);
    expect(toasts.at(-1)?.message).toBe('Linked UPC 0 36000 29145 2 to Fairlife 2% milk');
    expect(el.querySelector('.link-target .scan-name')?.textContent).toBe('Medium salsa');
    expect(names('[aria-labelledby="unlinked-title"]')).toEqual(['Medium salsa', 'Goya black bean soup']);
    expect(names('[aria-labelledby="linked-title"]')).toEqual(['Fairlife 2% milk', 'Large eggs', 'Signature jasmine rice']);

    press(el, 'Skip this one');
    await settle();
    expect(el.querySelector('.link-target .scan-name')?.textContent).toBe('Goya black bean soup');

    await page.onScan({ code: '4006381333931', format: 'ean_13' });
    await settle();
    // Salsa was skipped, so linking the last one ends the run and turns the camera off.
    expect(el.querySelector('.link-slip')).toBeNull();
    expect(names('[aria-labelledby="unlinked-title"]')).toEqual(['Medium salsa']);
  });

  it('asks before taking a UPC from another item', async () => {
    const { el, page, settle } = await render();
    press(el, 'Scan the UPC of Medium salsa');
    await settle();
    await page.onScan({ code: '96385074', format: 'ean_8' });
    await settle();
    expect(saved).toEqual([]);
    expect(el.querySelector('.link-conflict')?.textContent).toContain('already linked to Oat milk');

    press(el, 'Keep it there');
    await settle();
    expect(el.querySelector('.link-conflict')).toBeNull();
    expect(el.querySelector('.link-target .scan-name')?.textContent).toBe('Medium salsa');

    await page.onScan({ code: '96385074', format: 'ean_8' });
    await settle();
    press(el, 'Link it to Medium salsa instead');
    await settle();
    expect(saved).toEqual(['96385074 Medium salsa']);
    expect(el.querySelector('.link-target .scan-name')?.textContent).toBe('Goya black bean soup');
  });

  it('links a typed number, and Undo unlinks it', async () => {
    const { el, settle, names } = await render();
    press(el, 'Scan the UPC of Fairlife 2% milk');
    await settle();
    const input = el.querySelector('#link-typed') as HTMLInputElement;
    input.value = '0 36000 29145 2';
    input.dispatchEvent(new Event('input'));
    (el.querySelector('.link-slip form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settle();
    expect(saved).toEqual(['0036000291452 Fairlife 2% milk']);

    toasts.at(-1)!.undo!();
    await new Promise((resolve) => setTimeout(resolve));
    await settle();
    expect(saved.at(-1)).toBe('unlink 0036000291452');
    expect(names('[aria-labelledby="unlinked-title"]')).toContain('Fairlife 2% milk');
  });
});
