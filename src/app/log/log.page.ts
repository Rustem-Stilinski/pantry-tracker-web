import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { Session } from '../core/session.service';
import { Toasts } from '../core/toast.service';
import { EntryList } from './entry-list.component';
import { LogForm } from './log-form.component';
import { LogStore } from './log.store';
import { QuickRepeats } from './quick-repeats.component';
import { TotalsTable } from './totals-table.component';

@Component({
  selector: 'app-log-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [LogStore],
  imports: [RouterLink, LogForm, QuickRepeats, TotalsTable, EntryList],
  template: `
    <div class="app">
      <header class="top">
        <div class="brand">
          <h1>Used Items Log</h1>
          <p class="sub">Write down what gets used up and how much, so everyone can see what to restock.</p>
        </div>
        <div class="account">
          <span class="who-me">{{ session.user()?.displayName }}</span>
          <button type="button" class="link-btn" (click)="signOut()">Sign out</button>
        </div>
      </header>

      <div class="household-bar">
        <div class="household-name">
          @if (session.households().length > 1) {
            <label class="label-caps" for="household-select">Log</label>
            <select id="household-select" [value]="store.householdId()" (change)="switchTo($any($event.target).value)">
              @for (h of session.households(); track h.id) { <option [value]="h.id">{{ h.name }}</option> }
            </select>
          } @else {
            <span class="label-caps">Log</span>
            <strong>{{ store.household()?.name ?? session.activeHousehold()?.name }}</strong>
          }
          <a routerLink="/household" class="link-btn">Start or join another</a>
        </div>
        @if (inviteCode(); as code) {
          <div class="invite">
            <span class="label-caps">Invite code</span>
            <code>{{ code }}</code>
            <button type="button" class="link-btn" (click)="copyCode(code)">{{ copied() ? 'Copied' : 'Copy' }}</button>
            <span class="members">{{ memberCount() }}</span>
          </div>
        }
      </div>

      <main class="grid">
        <div class="side">
          <app-log-form />
          <app-quick-repeats />
        </div>

        <section class="ledger" aria-label="Ledger">
          <div class="month-bar">
            <div class="month-nav">
              <button type="button" class="icon-btn" (click)="store.goToMonth(-1)" aria-label="Previous month">‹</button>
              <h2>{{ store.monthName() }}</h2>
              <button type="button" class="icon-btn" (click)="store.goToMonth(1)" [disabled]="store.isCurrentMonth()" aria-label="Next month">›</button>
            </div>
            <span class="month-stats">{{ monthStats() }}</span>
          </div>
          <app-totals-table />
          <app-entry-list />
        </section>
      </main>
    </div>
  `,
})
export class LogPage {
  protected readonly session = inject(Session);
  protected readonly store = inject(LogStore);
  private readonly toasts = inject(Toasts);
  private readonly router = inject(Router);
  protected readonly copied = signal(false);

  /** "K7QM3XRP" shown as "K7QM-3XRP" so it's easy to read out loud. */
  protected readonly inviteCode = computed(() => {
    const code = this.store.household()?.inviteCode;
    return code ? `${code.slice(0, 4)}-${code.slice(4)}` : null;
  });

  protected readonly memberCount = computed(() => {
    const n = this.store.household()?.members.length ?? 0;
    return n === 1 ? 'Only you so far' : `${n} people`;
  });

  protected readonly monthStats = computed(() => {
    const entries = this.store.entries();
    if (!entries) return '';
    const items = new Set(entries.map((e) => e.itemName.trim().toLowerCase())).size;
    return `${entries.length} ${entries.length === 1 ? 'entry' : 'entries'} · ${items} ${items === 1 ? 'item' : 'items'}`;
  });

  constructor() {
    // (Re)open whenever the active household changes.
    effect(() => {
      const id = this.session.activeHouseholdId();
      if (id) untracked(() => void this.store.open());
    });
  }

  protected switchTo(id: string): void {
    this.session.setActiveHousehold(id);
  }

  protected async copyCode(code: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(code);
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    } catch {
      this.toasts.show(`Copy didn’t work here. The code is ${code}.`);
    }
  }

  protected async signOut(): Promise<void> {
    await this.session.signOut();
    await this.router.navigateByUrl('/sign-in');
  }
}
