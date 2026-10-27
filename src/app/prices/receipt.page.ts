import { ChangeDetectionStrategy, Component, effect, inject, input, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { Api } from '../core/api.service';
import { amount, errorMessage } from '../core/format';
import { ReceiptDetail } from '../core/models';
import { money, percent, unitPrice } from '../core/money';
import { Toasts } from '../core/toast.service';
import { householdId } from './household-id';

/** One receipt: price changes it revealed, every line, and totals. */
@Component({
  selector: 'app-receipt-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <a routerLink="/prices/receipts" class="back-link">‹ Receipts</a>
    @if (error()) {
      <div class="empty"><strong>That receipt didn’t load</strong><p>{{ error() }}</p></div>
    } @else if (!receipt()) {
      <p class="loading">Loading receipt…</p>
    } @else {
      @let r = receipt()!;
      <div class="item-head">
        <h2 class="page-title">{{ r.storeName }}</h2>
        @if (r.storeLocation) { <p class="store-location">{{ r.storeLocation }}</p> }
        <span class="label-caps">{{ dateFmt.format(date(r.purchasedAt)) }} · {{ r.items.length }} items · {{ money(r.total) }}</span>
      </div>

      @if (r.priceChanges.length) {
        <section class="block callout" aria-labelledby="receipt-changes">
          <h3 class="label-caps" id="receipt-changes">Price changes since you last bought these</h3>
          <ul class="change-list compact">
            @for (c of r.priceChanges; track c.itemKey + c.unit) {
              <li>
                <a class="change-row" routerLink="/prices/item" [queryParams]="{ item: c.itemName, unit: c.unit }">
                  <span class="delta" [class.up]="c.changePercent > 0" [class.down]="c.changePercent < 0">
                    {{ c.changePercent > 0 ? '▲' : '▼' }} {{ pct(c.changePercent) }}
                  </span>
                  <span class="change-name">{{ c.itemName }}</span>
                  <span class="change-detail">was {{ price(c.previousPrice, c.unit) }} at {{ c.previousStore }}</span>
                </a>
              </li>
            }
          </ul>
        </section>
      }

      <div class="line-table">
        <div class="line-row head" aria-hidden="true">
          <span>Item</span><span class="num">Qty</span><span class="num">Price</span><span class="num">Total</span>
        </div>
        @for (line of r.items; track line.id) {
          <div class="line-row">
            <span class="l-name">
              <a routerLink="/prices/item" [queryParams]="{ item: line.name, unit: line.unit }">{{ line.name }}</a>
              <small>{{ line.category }}@if (line.receiptText) { · <code>{{ line.receiptText }}</code> }</small>
            </span>
            <span class="num">{{ qty(line.quantity, line.unit) }}</span>
            <span class="num">{{ price(line.unitPrice, line.unit) }}</span>
            <span class="num strong">{{ money(line.lineTotal) }}</span>
          </div>
        }
        <div class="totals-foot">
          @if (r.subtotal !== null) { <span>Subtotal</span><span class="num">{{ money(r.subtotal) }}</span> }
          @if (r.tax !== null) { <span>Tax</span><span class="num">{{ money(r.tax) }}</span> }
          <span class="strong">Total</span><span class="num strong">{{ money(r.total) }}</span>
        </div>
      </div>

      <div class="danger-zone">
        @if (confirming()) {
          <button type="button" class="del armed" (click)="remove(r)">Delete this receipt</button>
          <button type="button" class="link-btn" (click)="confirming.set(false)">Keep it</button>
        } @else {
          <button type="button" class="link-btn muted-link" (click)="confirming.set(true)">Delete receipt…</button>
        }
      </div>
    }
  `,
})
export class ReceiptPage {
  /** From the route: /prices/receipts/:id */
  readonly id = input<string>();

  private readonly api = inject(Api);
  private readonly router = inject(Router);
  private readonly toasts = inject(Toasts);
  private readonly householdId = householdId();
  protected readonly receipt = signal<ReceiptDetail | null>(null);
  protected readonly error = signal('');
  protected readonly confirming = signal(false);
  protected readonly dateFmt = new Intl.DateTimeFormat(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
  protected readonly money = money;
  protected readonly price = unitPrice;
  protected readonly pct = percent;

  constructor() {
    effect(() => {
      const id = this.id();
      untracked(() => void this.load(id));
    });
  }

  /** "×2" for counted items, "2.31 lb" for weighed ones. */
  protected qty(quantity: number, unit: string): string {
    return unit === 'pcs' ? `×${Number(quantity)}` : amount(Number(quantity), unit);
  }

  protected date(iso: string): Date {
    return new Date(iso);
  }

  protected async remove(r: ReceiptDetail): Promise<void> {
    try {
      await firstValueFrom(this.api.deleteReceipt(this.householdId(), r.id));
      this.toasts.show(`Deleted the ${r.storeName} receipt`);
      await this.router.navigateByUrl('/prices/receipts');
    } catch (err) {
      this.toasts.show(errorMessage(err, 'Couldn’t delete the receipt. Try again.'));
    }
  }

  private async load(id: string | undefined): Promise<void> {
    if (!id) return;
    this.receipt.set(null);
    try {
      this.receipt.set(await firstValueFrom(this.api.receipt(this.householdId(), id)));
    } catch (err) {
      this.error.set(errorMessage(err, 'Reload the page to try again.'));
    }
  }
}
