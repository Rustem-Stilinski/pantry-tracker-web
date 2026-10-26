import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { amount } from '../core/format';
import { FrequentItem } from '../core/models';
import { LogStore } from './log.store';

/** "Used again?" — one tap logs the same amount as last time. */
@Component({
  selector: 'app-quick-repeats',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="quick" aria-labelledby="quick-title">
      <div class="quick-head">
        <h2 id="quick-title">Used again?</h2>
        <p class="hint">One tap logs the same amount as last time.</p>
      </div>
      @if (store.frequent().length) {
        <ul class="quick-list">
          @for (item of store.frequent(); track item.itemName) {
            <li>
              <button type="button" class="quick-btn" [disabled]="store.saving()" (click)="log(item)"
                      [attr.aria-label]="'Log ' + amount(item.quantity, item.unit) + ' of ' + item.itemName + ' now'">
                <span class="qname">{{ item.itemName }}</span>
                <span class="qadd">+{{ amount(item.quantity, item.unit) }}</span>
              </button>
            </li>
          }
        </ul>
      } @else {
        <p class="empty-mini">Your most-logged items will appear here once a few entries are in.</p>
      }
    </section>
  `,
})
export class QuickRepeats {
  protected readonly store = inject(LogStore);
  protected readonly amount = amount;

  protected log(item: FrequentItem): void {
    void this.store.add({
      itemName: item.itemName,
      quantity: item.quantity,
      unit: item.unit,
      category: item.category,
    });
  }
}
