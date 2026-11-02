import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { Api } from '../core/api.service';
import { barcodeLabel, displayBarcode } from '../core/barcode';
import { amount, errorMessage, placeName, relativeDay } from '../core/format';
import { ItemBarcode, ItemHistory } from '../core/models';
import { money, percent, unitPrice } from '../core/money';
import { Toasts } from '../core/toast.service';
import { householdId } from './household-id';
import { PriceChart } from './price-chart.component';

/** One item's price history: its UPCs, headline numbers, chart, prices by store, every purchase. */
@Component({
  selector: 'app-item-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, PriceChart],
  template: `
    <a routerLink="/prices" class="back-link">‹ All items</a>
    @if (error()) {
      <div class="empty"><strong>That item didn’t load</strong><p>{{ error() }}</p></div>
    } @else if (!history()) {
      <p class="loading">Loading price history…</p>
    } @else {
      @let h = history()!;
      <div class="item-head">
        <h2 class="page-title">{{ h.summary.itemName }}</h2>
        <span class="label-caps">{{ h.summary.category }} · per {{ h.summary.unit === 'pcs' ? 'item' : h.summary.unit }}</span>
      </div>

      <div class="upc-row">
        @for (b of barcodes(); track b.code) {
          @if (b.source === 'receipt') {
            <span class="upc-chip from-receipt" title="Printed on this item’s receipt; scanning the product links its UPC">
              <span class="label-caps">On receipt</span>
              <code>{{ show(b.code) }}</code>
            </span>
          } @else {
            <span class="upc-chip">
              <span class="label-caps">{{ label(b.code) }}</span>
              <code>{{ show(b.code) }}</code>
              <button type="button" class="upc-remove" [attr.aria-label]="'Remove ' + label(b.code) + ' ' + show(b.code)"
                      (click)="unlink(b)">×</button>
            </span>
          }
        } @empty {
          <span class="hint">No UPC linked yet.</span>
        }
        <a class="link-btn" routerLink="/scan" [queryParams]="{ for: item() }">
          {{ barcodes().length ? 'Scan another UPC' : 'Scan its UPC' }}
        </a>
      </div>

      <dl class="stat-row">
        <div>
          <dt>Latest</dt>
          <dd>{{ price(h.summary.latestPrice) }}</dd>
          <small>{{ h.summary.latestStore }} · {{ day(h.summary.latestAt) }}
            @if (h.summary.changePercent !== null && h.summary.changePercent !== 0) {
              <span class="delta small" [class.up]="h.summary.changePercent > 0" [class.down]="h.summary.changePercent < 0">
                {{ h.summary.changePercent > 0 ? '▲' : '▼' }} {{ pct(h.summary.changePercent) }}
              </span>
            }
          </small>
        </div>
        <div>
          <dt>Lowest</dt>
          <dd>{{ price(h.summary.lowestPrice) }}</dd>
          <small>{{ h.summary.lowestStore }} · {{ day(h.summary.lowestAt) }}</small>
        </div>
        <div>
          <dt>Average</dt>
          <dd>{{ price(h.summary.averagePrice) }}</dd>
          <small>over {{ h.summary.purchases }} {{ h.summary.purchases === 1 ? 'purchase' : 'purchases' }}</small>
        </div>
      </dl>

      <section class="block" aria-labelledby="chart-title">
        <h3 class="label-caps" id="chart-title">Price over time</h3>
        <app-price-chart [points]="h.points" [unit]="h.summary.unit" />
      </section>

      @if (h.stores.length > 1) {
        <section class="block" aria-labelledby="stores-title">
          <h3 class="label-caps" id="stores-title">By store · cheapest first</h3>
          <div class="store-table">
            @for (s of h.stores; track s.storeName; let first = $first) {
              <div class="store-row">
                <span class="s-name">{{ s.storeName }} @if (first) { <span class="chip-good">Cheapest</span> }</span>
                <span class="num">{{ price(s.latestPrice) }}</span>
                <small>last {{ day(s.latestAt) }} · {{ s.purchases }}×</small>
              </div>
            }
          </div>
        </section>
      }

      <section class="block" aria-labelledby="purchases-title">
        <h3 class="label-caps" id="purchases-title">Every purchase</h3>
        <div class="purchase-table">
          @for (p of newestFirst(); track $index) {
            <a class="purchase-row" [routerLink]="['/prices/receipts', p.receiptId]">
              <span>{{ dateFmt.format(date(p.purchasedAt)) }}</span>
              <span>{{ p.storeName }}@if (p.storeLocation) { <small class="muted"> · {{ place(p.storeLocation) }}</small>}</span>
              <span class="num">{{ qty(p.quantity, h.summary.unit) }}</span>
              <span class="num">{{ price(p.unitPrice) }}</span>
              <span class="num strong">{{ money(p.lineTotal) }}</span>
            </a>
          }
        </div>
      </section>
    }
  `,
})
export class ItemPage {
  protected readonly place = placeName;
  /** From the query string: /prices/item?item=Eggs, 12 ct&unit=pcs */
  readonly item = input<string>();
  readonly unit = input<string>();

  private readonly api = inject(Api);
  private readonly toasts = inject(Toasts);
  private readonly householdId = householdId();
  protected readonly history = signal<ItemHistory | null>(null);
  /** UPCs linked to this item; scanning one shows these prices. */
  protected readonly barcodes = signal<ItemBarcode[]>([]);
  protected readonly show = displayBarcode;
  protected readonly label = barcodeLabel;
  protected readonly error = signal('');
  protected readonly dateFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  protected readonly money = money;
  protected readonly pct = percent;

  protected readonly newestFirst = computed(() => [...(this.history()?.points ?? [])].reverse());

  constructor() {
    effect(() => {
      const item = this.item();
      const unit = this.unit();
      untracked(() => void this.load(item, unit));
    });
  }

  protected price(value: number): string {
    return unitPrice(value, this.history()?.summary.unit ?? 'pcs');
  }

  /** "×2" for counted items, "2.31 lb" for weighed ones. */
  protected qty(quantity: number, unit: string): string {
    return unit === 'pcs' ? `×${Number(quantity)}` : amount(Number(quantity), unit);
  }

  protected day(iso: string): string {
    return relativeDay(new Date(iso));
  }

  protected date(iso: string): Date {
    return new Date(iso);
  }

  /** Unlinks a UPC, with Undo. */
  protected async unlink(barcode: ItemBarcode): Promise<void> {
    const id = this.householdId();
    try {
      await firstValueFrom(this.api.unlinkBarcode(id, barcode.code));
      this.barcodes.update((list) => list.filter((b) => b.code !== barcode.code));
      this.toasts.show(`Removed ${barcodeLabel(barcode.code)} ${displayBarcode(barcode.code)}`, () => {
        void firstValueFrom(this.api.saveBarcode(id, barcode.code, barcode.itemName))
          .then(() => this.loadBarcodes(barcode.itemName))
          .catch(() => this.toasts.show('Couldn’t put that UPC back. Scan it again to link it.'));
      });
    } catch (err) {
      this.toasts.show(errorMessage(err, 'Couldn’t remove that UPC. Try again.'));
    }
  }

  private async loadBarcodes(item: string): Promise<void> {
    try {
      this.barcodes.set(await firstValueFrom(this.api.itemBarcodes(this.householdId(), item)));
    } catch {
      this.barcodes.set([]); // the prices still show without them
    }
  }

  private async load(item: string | undefined, unit: string | undefined): Promise<void> {
    this.history.set(null);
    this.barcodes.set([]);
    this.error.set('');
    if (!item) {
      this.error.set('Pick an item from the list.');
      return;
    }
    void this.loadBarcodes(item);
    try {
      this.history.set(await firstValueFrom(this.api.priceHistory(this.householdId(), item, unit)));
    } catch (err) {
      this.error.set(errorMessage(err, 'Reload the page to try again.'));
    }
  }
}
