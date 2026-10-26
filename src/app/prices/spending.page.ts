import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { Api } from '../core/api.service';
import { errorMessage } from '../core/format';
import { Amount, YearSpending } from '../core/models';
import { money } from '../core/money';
import { TIME_ZONE, householdId } from './household-id';

/** Spending per month (bars), then the chosen month split by store and by category. */
@Component({
  selector: 'app-spending-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="month-bar">
      <div class="month-nav">
        <button type="button" class="icon-btn" (click)="go(-1)" aria-label="Previous year">‹</button>
        <h2>{{ year() }}</h2>
        <button type="button" class="icon-btn" (click)="go(1)" [disabled]="year() >= currentYear" aria-label="Next year">›</button>
      </div>
      @if (data(); as d) { <span class="month-stats">{{ money(d.total) }} this year</span> }
    </div>

    @if (error()) {
      <div class="empty"><strong>Spending didn’t load</strong><p>{{ error() }}</p></div>
    } @else if (!data()) {
      <p class="loading">Adding it up…</p>
    } @else if (data()!.total === 0) {
      <div class="empty"><strong>No receipts in {{ year() }}</strong><p>Spending shows up here once receipts are saved.</p></div>
    } @else {
      <section class="block" aria-labelledby="bars-title">
        <h3 class="label-caps" id="bars-title">Spent per month · tap a month for details</h3>
        <div class="bars" role="list">
          @for (m of data()!.months; track m.month; let i = $index) {
            <button type="button" class="bar-col" role="listitem" [class.selected]="i === selected()"
                    (click)="selected.set(i)" [attr.aria-label]="monthNames[i] + ': ' + money(m.total)"
                    [attr.aria-pressed]="i === selected()">
              <span class="bar-value">{{ i === selected() && m.total > 0 ? short(m.total) : '' }}</span>
              <span class="bar-track"><span class="bar" [style.height.%]="barHeight(m.total)"></span></span>
              <span class="bar-label">{{ monthNames[i].slice(0, 3) }}</span>
            </button>
          }
        </div>
      </section>

      @if (month(); as m) {
        <section class="block" aria-labelledby="month-title">
          <div class="block-head">
            <h3 class="page-subtitle" id="month-title">{{ monthNames[selected()] }} {{ year() }}</h3>
            <span class="month-stats">{{ money(m.total) }} · {{ m.receipts }} {{ m.receipts === 1 ? 'receipt' : 'receipts' }}</span>
          </div>
          @if (m.total === 0) {
            <p class="loading">No receipts this month.</p>
          } @else {
            <div class="split">
              <div>
                <h4 class="label-caps">By store</h4>
                <ul class="hbars">
                  @for (a of m.byStore; track a.name) {
                    <li>
                      <span class="hb-name">{{ a.name }}</span>
                      <span class="hb-track"><span class="hb" [style.width.%]="share(a, m.byStore)"></span></span>
                      <span class="num">{{ money(a.amount) }}</span>
                    </li>
                  }
                </ul>
              </div>
              <div>
                <h4 class="label-caps">By category</h4>
                <ul class="hbars">
                  @for (a of m.byCategory; track a.name) {
                    <li>
                      <span class="hb-name">{{ a.name }}</span>
                      <span class="hb-track"><span class="hb" [style.width.%]="share(a, m.byCategory)"></span></span>
                      <span class="num">{{ money(a.amount) }}</span>
                    </li>
                  }
                </ul>
              </div>
            </div>
          }
        </section>
      }
    }
  `,
})
export class SpendingPage {
  private readonly api = inject(Api);
  private readonly householdId = householdId();
  protected readonly currentYear = new Date().getFullYear();
  protected readonly year = signal(this.currentYear);
  protected readonly data = signal<YearSpending | null>(null);
  protected readonly error = signal('');
  protected readonly selected = signal(new Date().getMonth());
  protected readonly monthNames = Array.from({ length: 12 }, (_, i) =>
    new Intl.DateTimeFormat(undefined, { month: 'long' }).format(new Date(2026, i, 1)));
  protected readonly money = money;

  private readonly max = computed(() => Math.max(...(this.data()?.months ?? []).map((m) => Number(m.total)), 0));
  protected readonly month = computed(() => this.data()?.months[this.selected()] ?? null);

  constructor() {
    void this.load();
  }

  protected go(delta: number): void {
    const next = this.year() + delta;
    if (next > this.currentYear) return;
    this.year.set(next);
    void this.load();
  }

  protected barHeight(total: number): number {
    const max = this.max();
    return max > 0 && total > 0 ? Math.max(2, (Number(total) / max) * 100) : 0;
  }

  protected share(a: Amount, all: Amount[]): number {
    const top = Math.max(...all.map((x) => Number(x.amount)));
    return top > 0 ? Math.max(1.5, (Number(a.amount) / top) * 100) : 0;
  }

  /** "$1.2k" style label for the selected bar. */
  protected short(value: number): string {
    return value >= 1000 ? `$${(value / 1000).toFixed(1)}k` : `$${Math.round(value)}`;
  }

  private async load(): Promise<void> {
    this.data.set(null);
    this.error.set('');
    try {
      const d = await firstValueFrom(this.api.spending(this.householdId(), this.year(), TIME_ZONE));
      this.data.set(d);
      // Current year: this month. Earlier years: the last month with any spending.
      if (this.year() === this.currentYear) this.selected.set(new Date().getMonth());
      else {
        const last = [...d.months].map((m, i) => ({ m, i })).reverse().find(({ m }) => Number(m.total) > 0);
        this.selected.set(last?.i ?? 11);
      }
    } catch (err) {
      this.error.set(errorMessage(err, 'Reload the page to try again.'));
    }
  }
}
