import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';

import { CATEGORIES, amount, dayKey, groupByDay, itemKey } from '../core/format';
import { Entry } from '../core/models';
import { LogStore } from './log.store';

/** Every entry in the month, grouped by day, with search, category filter and remove. */
@Component({
  selector: 'app-entry-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="block" aria-labelledby="entries-title">
      <h3 class="label-caps" id="entries-title">Every entry</h3>

      @if (store.entries(); as entries) {
        @if (store.loadError(); as error) {
          <div class="empty"><strong>This month didn’t load</strong><p>{{ error }}</p></div>
        } @else if (!entries.length) {
          <div class="empty">
            @if (store.isCurrentMonth()) {
              <strong>Nothing logged in {{ store.monthName() }} yet</strong>
              <p>Use the form to log the first item, like a roll of paper towels or a bottle of dish soap.
                 Entries are grouped by day here, and everyone in this log sees them.</p>
            } @else {
              <strong>Nothing was logged in {{ store.monthName() }}</strong>
              <p>Use the arrows to move between months.</p>
            }
          </div>
        } @else {
          <div class="entries-tools">
            <input type="search" id="entry-search" placeholder="Filter by item, note or category"
                   aria-label="Filter entries" [value]="search()" (input)="search.set($any($event.target).value)">
            @if (categoriesPresent().length > 1) {
              <div class="filters">
                <button type="button" class="filter" [attr.aria-pressed]="category() === ''" (click)="category.set('')">All</button>
                @for (c of categoriesPresent(); track c) {
                  <button type="button" class="filter" [attr.aria-pressed]="category() === c" (click)="category.set(c)">{{ c }}</button>
                }
              </div>
            }
          </div>

          @for (day of days(); track day.key) {
            <div class="day">
              <div class="day-head">
                <strong>{{ dayTitle(day.key, day.date) }}</strong>
                @if (isRecent(day.key)) { <span class="date">{{ dayFmt.format(day.date) }}</span> }
                <span class="count">{{ day.items.length }} {{ day.items.length === 1 ? 'entry' : 'entries' }}</span>
              </div>
              @for (e of day.items; track e.id) {
                <div class="erow">
                  <div class="r-time">{{ timeFmt.format(date(e)) }}</div>
                  <div class="r-main">
                    <span class="r-name">{{ e.itemName }}</span>
                    <div class="r-meta">
                      <span class="r-cat">{{ e.category }}</span>
                      @if (e.note) { <span class="note">{{ e.note }}</span> }
                      @if (e.loggedBy && store.memberNames().get(e.loggedBy); as who) { <span class="who">{{ who }}</span> }
                    </div>
                  </div>
                  <div class="r-amt">{{ amount(e.quantity, e.unit) }}</div>
                  @if (armed() === e.id) {
                    <button type="button" class="del armed" (click)="remove(e)" [attr.aria-label]="'Confirm removing ' + e.itemName">Remove</button>
                  } @else {
                    <button type="button" class="del" (click)="arm(e)" [attr.aria-label]="'Remove entry: ' + e.itemName" title="Remove entry">✕</button>
                  }
                </div>
              }
            </div>
          } @empty {
            <div class="empty">
              <strong>No entries match</strong>
              <p>Clear the filter to see all {{ entries.length }} entries for {{ store.monthName() }}.</p>
            </div>
          }
        }
      } @else {
        <p class="loading">Loading entries…</p>
      }
    </section>
  `,
})
export class EntryList {
  protected readonly store = inject(LogStore);
  protected readonly amount = amount;
  protected readonly search = signal('');
  protected readonly category = signal('');
  protected readonly armed = signal<string | null>(null);
  private armTimer: ReturnType<typeof setTimeout> | undefined;

  protected readonly dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  protected readonly timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

  protected readonly categoriesPresent = computed(() => {
    const present = new Set((this.store.entries() ?? []).map((e) => e.category));
    const order = (c: string) => {
      const i = (CATEGORIES as readonly string[]).indexOf(c);
      return i === -1 ? CATEGORIES.length : i;
    };
    return [...present].sort((a, b) => order(a) - order(b) || a.localeCompare(b));
  });

  protected readonly days = computed(() => {
    const q = itemKey(this.search());
    const cat = this.category();
    const visible = (this.store.entries() ?? []).filter((e) => {
      if (cat && e.category !== cat) return false;
      if (!q) return true;
      return [e.itemName, e.note ?? '', e.category].some((text) => itemKey(text).includes(q));
    });
    return groupByDay(visible, (e) => this.date(e));
  });

  protected date(e: Entry): Date {
    return new Date(e.usedAt);
  }

  protected isRecent(key: string): boolean {
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    return key === dayKey(now) || key === dayKey(yesterday);
  }

  protected dayTitle(key: string, date: Date): string {
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (key === dayKey(now)) return 'Today';
    if (key === dayKey(yesterday)) return 'Yesterday';
    return this.dayFmt.format(date);
  }

  /** First tap arms the button ("Remove"), second tap within a few seconds removes. */
  protected arm(e: Entry): void {
    clearTimeout(this.armTimer);
    this.armed.set(e.id);
    this.armTimer = setTimeout(() => this.armed.set(null), 3500);
  }

  protected remove(e: Entry): void {
    clearTimeout(this.armTimer);
    this.armed.set(null);
    void this.store.remove(e);
  }
}
