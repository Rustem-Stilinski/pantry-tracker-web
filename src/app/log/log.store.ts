import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { Api } from '../core/api.service';
import { amount, errorMessage, itemKey, monthKey, monthLabel, shiftMonth } from '../core/format';
import { Entry, FrequentItem, Household, ItemTotal, NewEntry } from '../core/models';
import { Session } from '../core/session.service';
import { Toasts } from '../core/toast.service';

export interface KnownItem {
  itemName: string;
  unit: string;
  category: string;
}

/**
 * State for the log page: the open household, the month being viewed, its entries and totals,
 * and the one-tap list. Provided by LogPage, so it lives exactly as long as the page.
 */
@Injectable()
export class LogStore {
  private readonly api = inject(Api);
  private readonly session = inject(Session);
  private readonly toasts = inject(Toasts);

  readonly timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  readonly currentMonth = monthKey(new Date());

  readonly householdId = computed(() => this.session.activeHouseholdId() ?? '');
  readonly household = signal<Household | null>(null);
  readonly month = signal(this.currentMonth);
  readonly monthName = computed(() => monthLabel(this.month()));
  readonly isCurrentMonth = computed(() => this.month() === this.currentMonth);

  /** null while the month is loading. */
  readonly entries = signal<Entry[] | null>(null);
  readonly totals = signal<ItemTotal[] | null>(null);
  readonly frequent = signal<FrequentItem[]>([]);
  readonly loadError = signal<string | null>(null);
  readonly saving = signal(false);

  /** userId -> name to show next to entries. */
  readonly memberNames = computed(() => {
    const me = this.session.user()?.id;
    const names = new Map<string, string>();
    for (const m of this.household()?.members ?? []) {
      names.set(m.userId, m.userId === me ? 'You' : m.displayName || 'Someone');
    }
    return names;
  });

  /** Items seen before, for autocomplete and for pre-filling unit and category. */
  readonly knownItems = computed(() => {
    const map = new Map<string, KnownItem>();
    for (const e of this.entries() ?? []) {
      const key = itemKey(e.itemName);
      if (!map.has(key)) map.set(key, { itemName: e.itemName, unit: e.unit, category: e.category });
    }
    for (const f of this.frequent()) {
      map.set(itemKey(f.itemName), { itemName: f.itemName, unit: f.unit, category: f.category });
    }
    return map;
  });

  private requestSeq = 0;
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  private events: EventSource | null = null;

  constructor() {
    const onVisible = () => {
      if (document.visibilityState === 'visible') this.scheduleRefresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    inject(DestroyRef).onDestroy(() => {
      document.removeEventListener('visibilitychange', onVisible);
      clearTimeout(this.refreshTimer);
      this.events?.close();
    });
  }

  /** Called when the page opens or the person switches household. */
  async open(): Promise<void> {
    const id = this.householdId();
    if (!id) return;
    this.household.set(null);
    this.listenForChanges(id);
    this.api.household(id).subscribe({ next: (h) => this.household.set(h), error: () => undefined });
    await Promise.all([this.loadMonth(), this.loadFrequent()]);
  }

  goToMonth(delta: number): void {
    const next = shiftMonth(this.month(), delta);
    if (next > this.currentMonth) return;
    this.month.set(next);
    void this.loadMonth();
  }

  async loadMonth(): Promise<void> {
    const id = this.householdId();
    const month = this.month();
    const seq = ++this.requestSeq;
    this.entries.set(null);
    this.totals.set(null);
    this.loadError.set(null);
    await this.fetchMonth(id, month, seq);
  }

  /** Re-fetches what is on screen without flashing the loading state. */
  async refresh(): Promise<void> {
    const seq = ++this.requestSeq;
    await Promise.all([this.fetchMonth(this.householdId(), this.month(), seq), this.loadFrequent()]);
  }

  async add(entry: NewEntry): Promise<boolean> {
    const id = this.householdId();
    this.saving.set(true);
    try {
      const saved = await firstValueFrom(this.api.addEntry(id, entry));
      const savedMonth = monthKey(new Date(saved.usedAt));
      const where = savedMonth === this.month() ? '' : ` in ${monthLabel(savedMonth)}`;
      this.toasts.show(`Logged ${saved.itemName} · ${amount(saved.quantity, saved.unit)}${where}`, () => {
        void this.remove(saved, false);
      });
      await this.refresh();
      return true;
    } catch (err) {
      this.toasts.show(errorMessage(err, 'Couldn’t save that entry. Try again.'));
      return false;
    } finally {
      this.saving.set(false);
    }
  }

  async remove(entry: Entry, announce = true): Promise<void> {
    try {
      await firstValueFrom(this.api.deleteEntry(this.householdId(), entry.id));
      this.toasts.show(announce ? `Removed ${entry.itemName} (${amount(entry.quantity, entry.unit)})` : 'Entry removed');
      await this.refresh();
    } catch (err) {
      this.toasts.show(errorMessage(err, 'Couldn’t remove that entry. Try again.'));
    }
  }

  private async fetchMonth(id: string, month: string, seq: number): Promise<void> {
    try {
      const [entries, totals] = await Promise.all([
        firstValueFrom(this.api.entries(id, month, this.timeZone)),
        firstValueFrom(this.api.totals(id, month, this.timeZone)),
      ]);
      if (seq !== this.requestSeq) return; // a newer request (another month) already answered
      this.entries.set(entries);
      this.totals.set(totals);
      this.loadError.set(null);
    } catch (err) {
      if (seq !== this.requestSeq) return;
      this.loadError.set(errorMessage(err, 'This month didn’t load. Reload the page to try again.'));
      this.entries.set([]);
      this.totals.set([]);
    }
  }

  private async loadFrequent(): Promise<void> {
    try {
      this.frequent.set(await firstValueFrom(this.api.frequent(this.householdId())));
    } catch {
      /* the one-tap list is a convenience; the rest of the page still works */
    }
  }

  /** Live updates: when anyone in the household adds or removes an entry, re-fetch. */
  private listenForChanges(id: string): void {
    this.events?.close();
    if (typeof EventSource === 'undefined') return;
    this.events = new EventSource(this.api.eventsUrl(id));
    this.events.addEventListener('entries-changed', () => this.scheduleRefresh());
    // EventSource reconnects on its own after errors; nothing else to do here.
  }

  /** Coalesces bursts (our own write + its echo over SSE) into one refresh. */
  private scheduleRefresh(): void {
    clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => void this.refresh(), 250);
  }
}
