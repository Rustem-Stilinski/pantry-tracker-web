import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { amount, relativeDay } from '../core/format';
import { Tally } from '../shared/tally.component';
import { LogStore } from './log.store';

/** Per-item totals for the month, with tally marks for how many times each was logged. */
@Component({
  selector: 'app-totals-table',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Tally],
  template: `
    <section class="block" aria-labelledby="totals-title">
      <h3 class="label-caps" id="totals-title">Totals for the month</h3>
      <div class="totals">
        @if (store.totals(); as totals) {
          @if (totals.length) {
            <div class="trow thead" aria-hidden="true">
              <span>Item</span><span class="right">Used</span><span>Times</span><span class="right">Last</span>
            </div>
            @for (t of totals; track t.itemKey + '|' + t.unit) {
              <div class="trow">
                <div class="t-item"><strong>{{ t.itemName }}</strong><small>{{ t.category }}</small></div>
                <div class="t-amt">{{ amount(t.quantity, t.unit) }}</div>
                <div class="t-times" [attr.aria-label]="'Logged ' + t.times + (t.times === 1 ? ' time' : ' times')">
                  <app-tally [count]="t.times" />
                  <span class="n">×{{ t.times }}{{ t.times > 20 ? '+' : '' }}</span>
                </div>
                <div class="t-last">{{ lastUsed(t.lastUsedAt) }}</div>
              </div>
            }
          } @else {
            <div class="empty">
              <strong>No totals yet</strong>
              <p>Each item gets a row here with how much was used, a tally of how many times, and when it was last used.</p>
            </div>
          }
        } @else {
          <p class="loading">Loading totals…</p>
        }
      </div>
    </section>
  `,
})
export class TotalsTable {
  protected readonly store = inject(LogStore);
  protected readonly amount = amount;

  protected lastUsed(iso: string): string {
    return relativeDay(new Date(iso));
  }
}
