import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { Api } from '../core/api.service';
import { errorMessage, itemKey, relativeDay } from '../core/format';
import { PricesOverview } from '../core/models';
import { money, percent, unitPrice } from '../core/money';
import { householdId } from './household-id';

@Component({
  selector: 'app-items-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    @if (error()) {
      <div class="empty"><strong>Prices didn’t load</strong><p>{{ error() }}</p></div>
    } @else if (!data()) {
      <p class="loading">Loading prices…</p>
    } @else if (!data()!.items.length) {
      <div class="empty big-empty">
        <strong>No receipts yet</strong>
        <p>Take a photo of your next receipt. The items and prices fill in for you; check them, save, and this page
           starts showing what everything costs and where it’s cheapest.</p>
        <a class="primary btn-small" routerLink="/prices/receipts/new">Add your first receipt</a>
      </div>
    } @else {
      @if (data()!.changes.length) {
        <section class="block" aria-labelledby="changes-title">
          <h3 class="label-caps" id="changes-title">Price changes · last 60 days</h3>
          <ul class="change-list">
            @for (c of data()!.changes; track c.itemKey + c.unit) {
              <li>
                <a class="change-row" routerLink="/prices/item" [queryParams]="{ item: c.itemName, unit: c.unit }">
                  <span class="delta" [class.up]="c.changePercent > 0" [class.down]="c.changePercent < 0">
                    {{ c.changePercent > 0 ? '▲' : '▼' }} {{ pct(c.changePercent) }}
                  </span>
                  <span class="change-name">{{ c.itemName }}</span>
                  <span class="change-detail">
                    {{ price(c.latestPrice, c.unit) }} at {{ c.latestStore }}, was {{ price(c.previousPrice, c.unit) }}
                    at {{ c.previousStore }} {{ day(c.previousAt) }}
                  </span>
                </a>
              </li>
            }
          </ul>
        </section>
      }

      <section class="block" aria-labelledby="items-title">
        <div class="block-head">
          <h3 class="label-caps" id="items-title">{{ data()!.items.length }} items · last 12 months</h3>
          <input type="search" id="item-search" placeholder="Find an item or category" aria-label="Find an item"
                 [value]="search()" (input)="search.set($any($event.target).value)">
        </div>
        <div class="price-table">
          <div class="price-row head" aria-hidden="true">
            <span>Item</span><span>Latest</span><span>Lowest</span><span class="num">Bought</span>
          </div>
          @for (it of visible(); track it.itemKey + it.unit) {
            <a class="price-row" routerLink="/prices/item" [queryParams]="{ item: it.itemName, unit: it.unit }">
              <span class="p-item"><strong>{{ it.itemName }}</strong><small>{{ it.category }}</small></span>
              <span class="p-latest">
                <span class="p-price">
                  {{ price(it.latestPrice, it.unit) }}
                  @if (it.changePercent !== null && it.changePercent !== 0) {
                    <span class="delta small" [class.up]="it.changePercent > 0" [class.down]="it.changePercent < 0">
                      {{ it.changePercent > 0 ? '▲' : '▼' }} {{ pct(it.changePercent) }}
                    </span>
                  }
                </span>
                <small>{{ it.latestStore }} · {{ day(it.latestAt) }}</small>
              </span>
              <span class="p-lowest">
                @if (it.lowestPrice < it.latestPrice) {
                  <span class="p-price">{{ price(it.lowestPrice, it.unit) }}</span>
                  <small>{{ it.lowestStore }} · {{ day(it.lowestAt) }}</small>
                } @else {
                  <small>Latest is the lowest</small>
                }
              </span>
              <span class="p-count num">{{ it.purchases }}×</span>
            </a>
          } @empty {
            <p class="loading">No items match “{{ search() }}”.</p>
          }
        </div>
      </section>
    }
  `,
})
export class ItemsPage {
  private readonly api = inject(Api);
  private readonly householdId = householdId();
  protected readonly data = signal<PricesOverview | null>(null);
  protected readonly error = signal('');
  protected readonly search = signal('');

  protected readonly visible = computed(() => {
    const q = itemKey(this.search());
    const items = this.data()?.items ?? [];
    return q ? items.filter((it) => itemKey(it.itemName).includes(q) || itemKey(it.category).includes(q)) : items;
  });

  protected readonly money = money;
  protected readonly price = unitPrice;
  protected readonly pct = percent;

  constructor() {
    void this.load();
  }

  protected day(iso: string): string {
    return relativeDay(new Date(iso));
  }

  private async load(): Promise<void> {
    try {
      this.data.set(await firstValueFrom(this.api.prices(this.householdId())));
    } catch (err) {
      this.error.set(errorMessage(err, 'Reload the page to try again.'));
    }
  }
}
