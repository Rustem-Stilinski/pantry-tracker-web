import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import {
  Entry, FrequentItem, Household, HouseholdSummary, ItemHistory, ItemTotal, NewEntry, PricesOverview,
  ReceiptDetail, ReceiptDraft, ReceiptSummary, SaveReceipt, StoreComparison, User, YearSpending,
} from './models';

/**
 * Thin typed wrapper over the REST API. All URLs are relative, so the browser sends the session
 * cookie and Angular adds the X-XSRF-TOKEN header to POST/DELETE requests automatically.
 */
@Injectable({ providedIn: 'root' })
export class Api {
  private readonly http = inject(HttpClient);

  // ---- auth
  me(): Observable<User> {
    return this.http.get<User>('/api/auth/me');
  }

  login(email: string, password: string): Observable<User> {
    return this.http.post<User>('/api/auth/login', { email, password });
  }

  register(email: string, password: string, displayName: string): Observable<User> {
    return this.http.post<User>('/api/auth/register', { email, password, displayName });
  }

  logout(): Observable<void> {
    return this.http.post<void>('/api/auth/logout', null);
  }

  // ---- households
  households(): Observable<HouseholdSummary[]> {
    return this.http.get<HouseholdSummary[]>('/api/households');
  }

  household(id: string): Observable<Household> {
    return this.http.get<Household>(`/api/households/${id}`);
  }

  createHousehold(name: string): Observable<Household> {
    return this.http.post<Household>('/api/households', { name });
  }

  joinHousehold(inviteCode: string): Observable<Household> {
    return this.http.post<Household>('/api/households/join', { inviteCode });
  }

  // ---- entries
  entries(householdId: string, month: string, tz: string): Observable<Entry[]> {
    return this.http.get<Entry[]>(`/api/households/${householdId}/entries`, { params: monthParams(month, tz) });
  }

  totals(householdId: string, month: string, tz: string): Observable<ItemTotal[]> {
    return this.http.get<ItemTotal[]>(`/api/households/${householdId}/totals`, { params: monthParams(month, tz) });
  }

  frequent(householdId: string, limit = 8): Observable<FrequentItem[]> {
    return this.http.get<FrequentItem[]>(`/api/households/${householdId}/items/frequent`, {
      params: new HttpParams().set('limit', limit),
    });
  }

  addEntry(householdId: string, entry: NewEntry): Observable<Entry> {
    return this.http.post<Entry>(`/api/households/${householdId}/entries`, entry);
  }

  deleteEntry(householdId: string, entryId: string): Observable<void> {
    return this.http.delete<void>(`/api/households/${householdId}/entries/${entryId}`);
  }

  // ---- receipts and prices

  /** Sends receipt photos to be read. Nothing is saved until saveReceipt. */
  readReceipt(householdId: string, photos: Blob[]): Observable<ReceiptDraft> {
    const form = new FormData();
    photos.forEach((photo, i) => form.append('photos', photo, `receipt-${i + 1}.jpg`));
    return this.http.post<ReceiptDraft>(`/api/households/${householdId}/receipts/read`, form);
  }

  saveReceipt(householdId: string, receipt: SaveReceipt): Observable<ReceiptDetail> {
    return this.http.post<ReceiptDetail>(`/api/households/${householdId}/receipts`, receipt);
  }

  receipts(householdId: string, month: string, tz: string): Observable<ReceiptSummary[]> {
    return this.http.get<ReceiptSummary[]>(`/api/households/${householdId}/receipts`, { params: monthParams(month, tz) });
  }

  receipt(householdId: string, receiptId: string): Observable<ReceiptDetail> {
    return this.http.get<ReceiptDetail>(`/api/households/${householdId}/receipts/${receiptId}`);
  }

  deleteReceipt(householdId: string, receiptId: string): Observable<void> {
    return this.http.delete<void>(`/api/households/${householdId}/receipts/${receiptId}`);
  }

  prices(householdId: string): Observable<PricesOverview> {
    return this.http.get<PricesOverview>(`/api/households/${householdId}/prices`);
  }

  priceHistory(householdId: string, item: string, unit?: string): Observable<ItemHistory> {
    let params = new HttpParams().set('item', item);
    if (unit) params = params.set('unit', unit);
    return this.http.get<ItemHistory>(`/api/households/${householdId}/prices/history`, { params });
  }

  compareStores(householdId: string): Observable<StoreComparison[]> {
    return this.http.get<StoreComparison[]>(`/api/households/${householdId}/prices/compare`);
  }

  spending(householdId: string, year: number, tz: string): Observable<YearSpending> {
    return this.http.get<YearSpending>(`/api/households/${householdId}/spending`, {
      params: new HttpParams().set('year', year).set('tz', tz),
    });
  }

  stores(householdId: string): Observable<string[]> {
    return this.http.get<string[]>(`/api/households/${householdId}/stores`);
  }

  /** URL of the Server-Sent Events stream for live updates. */
  eventsUrl(householdId: string): string {
    return `/api/households/${householdId}/events`;
  }
}

function monthParams(month: string, tz: string): HttpParams {
  return new HttpParams().set('month', month).set('tz', tz);
}
