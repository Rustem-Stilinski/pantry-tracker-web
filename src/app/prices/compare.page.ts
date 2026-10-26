import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { Api } from '../core/api.service';
import { errorMessage, relativeDay } from '../core/format';
import { StoreComparison } from '../core/models';
import { unitPrice } from '../core/money';
import { householdId } from './household-id';

/** Items bought at two or more stores in the last six months, biggest difference first. */
@Component({
  selector: 'app-compare-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    @if (error()) {
      <div class="empty"><strong>The comparison didn’t load</strong><p>{{ error() }}</p></div>
    } @else if (!rows()) {
      <p class="loading">Comparing stores…</p>
    } @else if (!rows()!.length) {
      <div class="empty">
        <strong>Nothing to compare yet</strong>
        <p>Once you’ve bought the same item at two different stores (in the last six months), it shows up here with
           the cheaper store first.</p>
      </div>
    } @else {
      <h3 class="label-caps">{{ rows()!.length }} items bought at more than one store · last 6 months</h3>
      <div class="compare-list">
        @for (row of rows(); track row.itemKey + row.unit) {
          <article class="compare-card">
            <header>
              <a class="compare-name" routerLink="/prices/item" [queryParams]="{ item: row.itemName, unit: row.unit }">{{ row.itemName }}</a>
              @if (row.savingsPercent >= 1) {
                <span class="savings">Save {{ whole(row.savingsPercent) }}% at {{ row.stores[0].storeName }}</span>
              } @else {
                <span class="savings same">Same price everywhere</span>
              }
            </header>
            <ul>
              @for (s of row.stores; track s.storeName; let first = $first) {
                <li [class.best]="first && row.savingsPercent >= 1">
                  <span class="s-name">{{ s.storeName }}</span>
                  <span class="num">{{ price(s.latestPrice, row.unit) }}</span>
                  <small>{{ day(s.latestAt) }}</small>
                </li>
              }
            </ul>
          </article>
        }
      </div>
    }
  `,
})
export class ComparePage {
  private readonly api = inject(Api);
  private readonly householdId = householdId();
  protected readonly rows = signal<StoreComparison[] | null>(null);
  protected readonly error = signal('');
  protected readonly price = unitPrice;

  constructor() {
    firstValueFrom(this.api.compareStores(this.householdId()))
      .then((rows) => this.rows.set(rows))
      .catch((err) => this.error.set(errorMessage(err, 'Reload the page to try again.')));
  }

  protected whole(value: number): number {
    return Math.round(Number(value));
  }

  protected day(iso: string): string {
    return relativeDay(new Date(iso));
  }
}
