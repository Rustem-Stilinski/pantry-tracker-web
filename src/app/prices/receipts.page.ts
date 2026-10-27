import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { Api } from '../core/api.service';
import { errorMessage, monthKey, monthLabel, placeName, shiftMonth } from '../core/format';
import { ReceiptSummary } from '../core/models';
import { money } from '../core/money';
import { TIME_ZONE, householdId } from './household-id';

/** Receipts for one month, newest first. */
@Component({
  selector: 'app-receipts-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <div class="month-bar">
      <div class="month-nav">
        <button type="button" class="icon-btn" (click)="go(-1)" aria-label="Previous month">‹</button>
        <h2>{{ label() }}</h2>
        <button type="button" class="icon-btn" (click)="go(1)" [disabled]="month() >= current" aria-label="Next month">›</button>
      </div>
      @if (receipts(); as list) {
        <span class="month-stats">{{ list.length }} {{ list.length === 1 ? 'receipt' : 'receipts' }} · {{ money(total()) }}</span>
      }
    </div>

    @if (error()) {
      <div class="empty"><strong>Receipts didn’t load</strong><p>{{ error() }}</p></div>
    } @else if (!receipts()) {
      <p class="loading">Loading receipts…</p>
    } @else if (!receipts()!.length) {
      <div class="empty">
        <strong>No receipts in {{ label() }}</strong>
        <p>Use <a routerLink="/prices/receipts/new">Add receipt</a> after your next shopping trip.</p>
      </div>
    } @else {
      <div class="receipt-list">
        @for (r of receipts(); track r.id) {
          <a class="receipt-row" [routerLink]="['/prices/receipts', r.id]">
            <span class="r-date">{{ dayFmt.format(date(r.purchasedAt)) }}</span>
            <span class="r-store"><strong>{{ r.storeName }}</strong><small>@if (r.storeLocation) { {{ place(r.storeLocation) }} · }{{ r.itemCount }} {{ r.itemCount === 1 ? 'item' : 'items' }}</small></span>
            <span class="num strong">{{ money(r.total) }}</span>
          </a>
        }
      </div>
    }
  `,
})
export class ReceiptsPage {
  private readonly api = inject(Api);
  private readonly householdId = householdId();
  protected readonly current = monthKey(new Date());
  protected readonly month = signal(this.current);
  protected readonly label = computed(() => monthLabel(this.month()));
  protected readonly receipts = signal<ReceiptSummary[] | null>(null);
  protected readonly error = signal('');
  protected readonly total = computed(() => (this.receipts() ?? []).reduce((sum, r) => sum + Number(r.total), 0));
  protected readonly dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  protected readonly money = money;
  protected readonly place = placeName;
  private seq = 0;

  constructor() {
    void this.load();
  }

  protected go(delta: number): void {
    const next = shiftMonth(this.month(), delta);
    if (next > this.current) return;
    this.month.set(next);
    void this.load();
  }

  protected date(iso: string): Date {
    return new Date(iso);
  }

  private async load(): Promise<void> {
    const seq = ++this.seq;
    this.receipts.set(null);
    this.error.set('');
    try {
      const list = await firstValueFrom(this.api.receipts(this.householdId(), this.month(), TIME_ZONE));
      if (seq === this.seq) this.receipts.set(list);
    } catch (err) {
      if (seq === this.seq) this.error.set(errorMessage(err, 'Reload the page to try again.'));
    }
  }
}
