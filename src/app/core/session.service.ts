import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { Api } from './api.service';
import { HouseholdSummary, User } from './models';

const ACTIVE_HOUSEHOLD_KEY = 'usedlog.activeHousehold';

/** Who is signed in, which logs (households) they belong to, and which one is open. */
@Injectable({ providedIn: 'root' })
export class Session {
  private readonly api = inject(Api);

  readonly user = signal<User | null>(null);
  readonly households = signal<HouseholdSummary[]>([]);
  readonly activeHouseholdId = signal<string | null>(null);
  readonly activeHousehold = computed(
    () => this.households().find((h) => h.id === this.activeHouseholdId()) ?? null,
  );

  private loading: Promise<void> | null = null;

  /** Loads the session once per page load; guards await this before deciding where to go. */
  ensureLoaded(): Promise<void> {
    this.loading ??= this.refresh();
    return this.loading;
  }

  async refresh(): Promise<void> {
    try {
      this.user.set(await firstValueFrom(this.api.me()));
    } catch (err) {
      // 401 just means "not signed in". The request also gives us a fresh CSRF cookie.
      if (err instanceof HttpErrorResponse && err.status === 401) {
        this.clear();
        return;
      }
      throw err;
    }
    await this.loadHouseholds();
  }

  async loadHouseholds(): Promise<void> {
    const list = await firstValueFrom(this.api.households());
    this.households.set(list);
    const saved = readStorage(ACTIVE_HOUSEHOLD_KEY);
    const pick = list.find((h) => h.id === saved) ?? list[0] ?? null;
    this.activeHouseholdId.set(pick?.id ?? null);
  }

  setActiveHousehold(id: string): void {
    this.activeHouseholdId.set(id);
    writeStorage(ACTIVE_HOUSEHOLD_KEY, id);
  }

  async signIn(email: string, password: string): Promise<void> {
    this.user.set(await firstValueFrom(this.api.login(email, password)));
    await this.loadHouseholds();
  }

  async register(email: string, password: string, displayName: string): Promise<void> {
    this.user.set(await firstValueFrom(this.api.register(email, password, displayName)));
    this.households.set([]);
    this.activeHouseholdId.set(null);
  }

  async signOut(): Promise<void> {
    try {
      await firstValueFrom(this.api.logout());
    } finally {
      this.clear();
      // Sign-out clears the CSRF cookie; fetch a new one so the next sign-in POST is accepted.
      await firstValueFrom(this.api.me()).catch(() => undefined);
    }
  }

  private clear(): void {
    this.user.set(null);
    this.households.set([]);
    this.activeHouseholdId.set(null);
  }
}

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage can be unavailable (private mode); remembering the choice is optional */
  }
}
