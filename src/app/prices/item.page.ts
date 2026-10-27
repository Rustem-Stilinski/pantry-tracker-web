import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { Api } from '../core/api.service';
import { amount, errorMessage, placeName, relativeDay } from '../core/format';
import { ItemHistory } from '../core/models';
import { money, percent, unitPrice } from '../core/money';
import { householdId } from './household-id';
import { PriceChart } from './price-chart.component';

/** One item's price history: headline numbers, chart, prices by store, every purchase. */
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
  private readonly householdId = householdId();
  protected readonly history = signal<ItemHistory | null>(null);
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

  private async load(item: string | undefined, unit: string | undefined): Promise<void> {
    this.history.set(null);
    this.error.set('');
    if (!item) {
      this.error.set('Pick an item from the list.');
      return;
    }
    try {
      this.history.set(await firstValueFrom(this.api.priceHistory(this.householdId(), item, unit)));
    } catch (err) {
      this.error.set(errorMessage(err, 'Reload the page to try again.'));
    }
  }
}
