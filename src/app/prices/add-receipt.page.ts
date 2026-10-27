import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { Api } from '../core/api.service';
import { UNITS, dayKey, errorMessage } from '../core/format';
import { ReceiptAlias, ReceiptDraft, SaveReceipt } from '../core/models';
import { RECEIPT_CATEGORIES, money, parseAmount, round2 } from '../core/money';
import { shrinkPhoto } from '../core/photo';
import { Toasts } from '../core/toast.service';
import { ReadProgress, findReceipt, readOnDevice } from './device-reader';
import { householdId } from './household-id';
import { ReceiptFrameComponent } from './receipt-frame.component';
import { Frame, WHOLE_PHOTO } from './receipt-image';
import { bestReading } from './receipt-parser';

type Step = 'photos' | 'reading' | 'review';

interface Photo {
  id: number;
  blob: Blob;
  url: string;
  /** Where the receipt is, for reading on this device; null while it's being found. */
  frame: Frame | null;
}

/** One editable receipt line. Numbers are kept as typed text so editing never fights the cursor. */
export interface Row {
  id: number;
  name: string;
  receiptText: string | null;
  qty: string;
  unit: string;
  unitPrice: string;
  lineTotal: string;
  category: string;
  /** Another reading of the total to offer, when the lines don't add up. */
  suggestion: string | null;
}

const MAX_PHOTOS = 4;

/** Changing quantity or unit price recalculates the line total; changing the total recalculates unit price. */
export function editRow(row: Row, field: keyof Row, value: string): Row {
  const next = { ...row, [field]: value } as Row;
  const qty = parseAmount(next.qty);
  if (field === 'qty' || field === 'unitPrice') {
    const price = parseAmount(next.unitPrice);
    if (qty > 0 && price >= 0) next.lineTotal = round2(qty * price).toFixed(2);
  } else if (field === 'lineTotal') {
    const total = parseAmount(next.lineTotal);
    if (qty > 0 && total >= 0) next.unitPrice = String(Math.round((total / qty) * 1000) / 1000);
  }
  return next;
}

@Component({
  selector: 'app-add-receipt-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, ReceiptFrameComponent],
  template: `
    <a routerLink="/prices/receipts" class="back-link">‹ Receipts</a>

    @switch (step()) {
      @case ('photos') {
        <section class="slip add-slip">
          <div class="slip-head"><h2>Add a receipt</h2></div>
          <div class="slip-body">
            <label class="photo-drop" for="receipt-photos">
              <input id="receipt-photos" type="file" accept="image/*" multiple (change)="addPhotos($event)">
              <strong>{{ photos().length ? 'Add another photo' : 'Take or choose a photo' }}</strong>
              <span>Lay the receipt flat in good light. Long receipt? Use up to {{ maxPhotos }} photos, top to bottom.</span>
            </label>

            @if (photos().length && framing()) {
              <p class="hint">Drag the corners so the frame holds just the receipt. Leaving out the table or bedspread around it helps the reader.</p>
              <ol class="framed-photos">
                @for (p of photos(); track p.id; let i = $index) {
                  <li>
                    <app-receipt-frame [src]="p.url" [label]="'Receipt photo ' + (i + 1)"
                                       [frame]="p.frame" (frameChange)="setFrame(p.id, $event)" />
                    <button type="button" class="thumb-remove" (click)="removePhoto(p.id)" [attr.aria-label]="'Remove photo ' + (i + 1)">✕</button>
                  </li>
                }
              </ol>
            } @else if (photos().length) {
              <ol class="thumbs">
                @for (p of photos(); track p.id; let i = $index) {
                  <li>
                    <img [src]="p.url" [alt]="'Receipt photo ' + (i + 1)">
                    <button type="button" class="thumb-remove" (click)="removePhoto(p.id)" [attr.aria-label]="'Remove photo ' + (i + 1)">✕</button>
                  </li>
                }
              </ol>
            }

            @if (message()) { <p class="form-msg" role="alert">{{ message() }}</p> }

            <button type="button" class="primary" [disabled]="!photos().length || preparing()" (click)="read()">
              {{ preparing() ? 'Preparing photos…' : 'Read receipt' }}
            </button>
            @if (offerDevice()) {
              <button type="button" class="secondary" [disabled]="!photos().length" (click)="readHere()">Read it on this device instead</button>
            }
            @if (claude() === false) {
              <p class="hint center-text">Reads on this device for free. You’ll check every line before saving.</p>
            }
            <button type="button" class="link-btn center" (click)="enterByHand()">Enter it by hand instead</button>
          </div>
        </section>
      }

      @case ('reading') {
        <section class="slip add-slip reading" aria-live="polite">
          <div class="slip-body">
            <div class="spinner" aria-hidden="true"></div>
            @if (progress(); as p) {
              <strong>{{ p.stage === 'Reading' ? 'Reading your receipt on this device…' : 'Getting the reader ready…' }}</strong>
              <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" [attr.aria-valuenow]="p.percent">
                <span [style.width.%]="p.percent"></span>
              </div>
              <p class="hint">
                @if (p.photos > 1) { Photo {{ p.photo }} of {{ p.photos }} · }{{ p.percent }}%
                @if (p.stage !== 'Reading') { · The first time takes longer while the reader downloads (about 7 MB). }
              </p>
            } @else {
              <strong>Reading your receipt…</strong>
              <p class="hint">This usually takes 10–20 seconds.</p>
            }
          </div>
        </section>
      }

      @case ('review') {
        <form class="slip review" (submit)="save($event)" novalidate>
          <div class="slip-head">
            <h2>Check the receipt</h2>
            <span class="label-caps">{{ rows().length }} {{ rows().length === 1 ? 'line' : 'lines' }}</span>
          </div>
          <div class="slip-body">
            @if (notes()) { <p class="notice">{{ notes() }}</p> }

            <div class="review-meta">
              <div class="field">
                <label for="r-store">Store</label>
                <input id="r-store" type="text" list="known-stores" maxlength="80" autocomplete="off"
                       placeholder="e.g. Giant" [value]="store()" (input)="store.set(val($event))">
                <datalist id="known-stores">
                  @for (s of knownStores(); track s) { <option [value]="s"></option> }
                </datalist>
              </div>
              <div class="field r-location">
                <label for="r-location">Location <span class="opt">optional</span></label>
                <input id="r-location" type="text" maxlength="160" autocomplete="off"
                       placeholder="e.g. 11620 Monument Dr, Fairfax, VA" [value]="location()" (input)="location.set(val($event))">
              </div>
              <div class="field">
                <label for="r-date">Date</label>
                <input id="r-date" type="date" [max]="today" [value]="date()" (input)="date.set(val($event))">
              </div>
              <div class="field">
                <label for="r-time">Time <span class="opt">optional</span></label>
                <input id="r-time" type="time" [value]="time()" (input)="time.set(val($event))">
              </div>
            </div>

            <div class="review-lines">
              @for (row of rows(); track row.id; let i = $index) {
                <div class="review-row">
                  <div class="rr-name">
                    <input type="text" maxlength="80" [attr.aria-label]="'Line ' + (i + 1) + ' item'" placeholder="Item"
                           [value]="row.name" (input)="edit(row.id, 'name', val($event))">
                    @if (row.receiptText) { <small>On receipt: <code>{{ row.receiptText }}</code></small> }
                  </div>
                  <label class="rr-field"><span>Qty</span>
                    <input type="text" inputmode="decimal" [value]="row.qty" (input)="edit(row.id, 'qty', val($event))">
                  </label>
                  <label class="rr-field"><span>Unit</span>
                    <select [value]="row.unit" (change)="edit(row.id, 'unit', val($event))">
                      @for (u of unitsFor(row.unit); track u) { <option [value]="u" [selected]="u === row.unit">{{ u }}</option> }
                    </select>
                  </label>
                  <label class="rr-field"><span>Each</span>
                    <input type="text" inputmode="decimal" [value]="row.unitPrice" (input)="edit(row.id, 'unitPrice', val($event))">
                  </label>
                  <label class="rr-field"><span>Total</span>
                    <input type="text" inputmode="decimal" [value]="row.lineTotal" (input)="edit(row.id, 'lineTotal', val($event))">
                  </label>
                  <label class="rr-field rr-cat"><span>Category</span>
                    <select [value]="row.category" (change)="edit(row.id, 'category', val($event))">
                      @for (c of categoriesFor(row.category); track c) { <option [value]="c" [selected]="c === row.category">{{ c }}</option> }
                    </select>
                  </label>
                  <button type="button" class="del" (click)="removeRow(row.id)" [attr.aria-label]="'Remove line ' + (i + 1)">✕</button>
                  @if (row.suggestion && row.suggestion !== row.lineTotal) {
                    <p class="rr-suggest">
                      Also read as <strong>{{ money(+row.suggestion) }}</strong>.
                      <button type="button" class="link-btn" (click)="edit(row.id, 'lineTotal', row.suggestion)">Use {{ money(+row.suggestion) }}</button>
                    </p>
                  }
                </div>
              }
              <button type="button" class="link-btn" (click)="addRow()">+ Add a line</button>
            </div>

            <div class="review-totals">
              <div class="field"><label for="r-subtotal">Subtotal <span class="opt">optional</span></label>
                <input id="r-subtotal" type="text" inputmode="decimal" [value]="subtotal()" (input)="subtotal.set(val($event))"></div>
              <div class="field"><label for="r-tax">Tax <span class="opt">optional</span></label>
                <input id="r-tax" type="text" inputmode="decimal" [value]="tax()" (input)="tax.set(val($event))"></div>
              <div class="field"><label for="r-total">Total <span class="opt">optional</span></label>
                <input id="r-total" type="text" inputmode="decimal" [value]="total()" (input)="total.set(val($event))"></div>
            </div>
            <p class="sum-check" [class.warn]="mismatch()">{{ sumCheck() }}</p>

            @if (message()) { <p class="form-msg" role="alert">{{ message() }}</p> }
            <button type="submit" class="primary" [disabled]="saving()">{{ saving() ? 'Saving…' : 'Save receipt' }}</button>
            <button type="button" class="link-btn center" (click)="startOver()">Start over</button>
          </div>
        </form>
      }
    }
  `,
})
export class AddReceiptPage {
  private readonly api = inject(Api);
  private readonly router = inject(Router);
  private readonly toasts = inject(Toasts);
  private readonly householdId = householdId();

  protected readonly maxPhotos = MAX_PHOTOS;
  protected readonly today = dayKey(new Date());
  protected readonly money = money;

  protected readonly step = signal<Step>('photos');
  protected readonly photos = signal<Photo[]>([]);
  protected readonly preparing = signal(false);
  protected readonly message = signal('');
  protected readonly saving = signal(false);

  protected readonly store = signal('');
  /** The store's branch, as printed under its name. */
  protected readonly location = signal('');
  protected readonly date = signal(this.today);
  protected readonly time = signal('');
  protected readonly rows = signal<Row[]>([]);
  protected readonly subtotal = signal('');
  protected readonly tax = signal('');
  protected readonly total = signal('');
  protected readonly notes = signal<string | null>(null);
  protected readonly knownStores = signal<string[]>([]);
  /** null until the server answers; false means photos are read on this device. */
  protected readonly claude = signal<boolean | null>(null);
  /** After a server read fails, offer reading on the device instead. */
  protected readonly offerDevice = signal(false);
  protected readonly progress = signal<ReadProgress | null>(null);
  /** Photos are read on this device, so show where the receipt is and let the person adjust it. */
  protected readonly framing = computed(() => this.claude() === false || this.offerDevice());

  protected readonly linesSum = computed(() =>
    round2(this.rows().reduce((sum, r) => sum + (parseAmount(r.lineTotal) || 0), 0)));
  protected readonly taxValue = computed(() => parseAmount(this.tax()) || 0);
  protected readonly totalValue = computed(() => parseAmount(this.total()));
  protected readonly mismatch = computed(() => {
    const total = this.totalValue();
    return total > 0 && Math.abs(this.linesSum() + this.taxValue() - total) > 0.05;
  });

  protected readonly sumCheck = computed(() => {
    const tax = this.taxValue();
    const lines = `Lines add up to ${money(this.linesSum())}${tax > 0 ? ` plus ${money(tax)} tax` : ''}.`;
    return this.mismatch()
      ? `${lines} The receipt total is ${money(this.totalValue())}: check for a missed or misread line.`
      : lines;
  });

  private nextId = 1;

  constructor() {
    firstValueFrom(this.api.stores(this.householdId())).then((s) => this.knownStores.set(s)).catch(() => undefined);
    firstValueFrom(this.api.receiptReader(this.householdId()))
      .then((status) => this.claude.set(status.claude))
      .catch(() => this.claude.set(false));
    inject(DestroyRef).onDestroy(() => this.photos().forEach((p) => URL.revokeObjectURL(p.url)));
  }

  protected val(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement).value;
  }

  // ---------- photos ----------

  protected async addPhotos(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    const room = MAX_PHOTOS - this.photos().length;
    if (files.length > room) this.message.set(`Only ${MAX_PHOTOS} photos fit on one receipt; extra photos were left out.`);
    else this.message.set('');
    this.preparing.set(true);
    try {
      for (const file of files.slice(0, Math.max(0, room))) {
        const blob = await shrinkPhoto(file);
        const id = this.nextId++;
        this.photos.update((list) => [...list, { id, blob, url: URL.createObjectURL(blob), frame: null }]);
        findReceipt(blob)
          .catch(() => WHOLE_PHOTO)
          .then((frame) => this.photos.update((list) => list.map((p) => (p.id === id && !p.frame ? { ...p, frame } : p))));
      }
    } catch (err) {
      this.message.set(err instanceof Error ? err.message : 'That photo couldn’t be used. Try another.');
    } finally {
      this.preparing.set(false);
    }
  }

  protected setFrame(id: number, frame: Frame | null): void {
    this.photos.update((list) => list.map((p) => (p.id === id ? { ...p, frame } : p)));
  }

  protected removePhoto(id: number): void {
    const photo = this.photos().find((p) => p.id === id);
    if (photo) URL.revokeObjectURL(photo.url);
    this.photos.update((list) => list.filter((p) => p.id !== id));
  }

  /** Claude on the server when it's set up, otherwise this device. */
  protected async read(): Promise<void> {
    if (this.claude() !== true) {
      await this.readHere();
      return;
    }
    this.message.set('');
    this.offerDevice.set(false);
    this.progress.set(null);
    this.step.set('reading');
    try {
      const draft = await firstValueFrom(this.api.readReceipt(this.householdId(), this.photos().map((p) => p.blob)));
      this.fill(draft);
      this.step.set('review');
    } catch (err) {
      this.message.set(errorMessage(err, 'Couldn’t read the receipt. Try again, or enter it by hand.'));
      this.offerDevice.set(true);
      this.step.set('photos');
    }
  }

  /** Free, private reading on this device, then the household's learned names on top. */
  protected async readHere(): Promise<void> {
    this.message.set('');
    this.offerDevice.set(false);
    this.progress.set({ photo: 1, photos: this.photos().length, percent: 0, stage: 'Getting the reader ready' });
    this.step.set('reading');
    try {
      const [readings, aliases] = await Promise.all([
        readOnDevice(this.photos().map((p) => ({ blob: p.blob, frame: p.frame })), (p) => this.progress.set(p)),
        firstValueFrom(this.api.receiptAliases(this.householdId())).catch((): ReceiptAlias[] => []),
      ]);
      this.fill(bestReading(readings, { knownStores: this.knownStores(), aliases }));
      this.step.set('review');
    } catch (err) {
      console.error('On-device reading failed', err);
      this.message.set('This device couldn’t read the photo. Try again, use a sharper photo, or enter it by hand.');
      this.step.set('photos');
    } finally {
      this.progress.set(null);
    }
  }

  protected enterByHand(): void {
    this.message.set('');
    this.notes.set(null);
    this.rows.set([this.blankRow()]);
    this.step.set('review');
  }

  protected startOver(): void {
    this.message.set('');
    this.store.set('');
    this.location.set('');
    this.date.set(this.today);
    this.time.set('');
    this.rows.set([]);
    this.subtotal.set('');
    this.tax.set('');
    this.total.set('');
    this.notes.set(null);
    this.offerDevice.set(false);
    this.step.set('photos');
  }

  private fill(draft: ReceiptDraft): void {
    this.store.set(draft.storeName ?? '');
    this.location.set(draft.storeLocation ?? '');
    this.date.set(draft.purchaseDate && draft.purchaseDate <= this.today ? draft.purchaseDate : this.today);
    this.time.set(draft.purchaseTime ?? '');
    this.subtotal.set(draft.subtotal != null ? Number(draft.subtotal).toFixed(2) : '');
    this.tax.set(draft.tax != null ? Number(draft.tax).toFixed(2) : '');
    this.total.set(draft.total != null ? Number(draft.total).toFixed(2) : '');
    this.notes.set(draft.notes ?? null);
    const rows = (draft.items ?? []).map((item) => ({
      id: this.nextId++,
      name: item.name ?? '',
      receiptText: item.receiptText || null,
      qty: String(item.quantity ?? 1),
      unit: item.unit || 'pcs',
      unitPrice: String(item.unitPrice ?? ''),
      lineTotal: item.lineTotal != null ? Number(item.lineTotal).toFixed(2) : '',
      category: item.category || 'Other',
      suggestion: item.suggestion != null ? Number(item.suggestion).toFixed(2) : null,
    }));
    this.rows.set(rows.length ? rows : [this.blankRow()]);
  }

  // ---------- lines ----------

  protected edit(id: number, field: keyof Row, value: string): void {
    this.rows.update((rows) => rows.map((r) => (r.id === id ? editRow(r, field, value) : r)));
  }

  protected addRow(): void {
    this.rows.update((rows) => [...rows, this.blankRow()]);
  }

  protected removeRow(id: number): void {
    this.rows.update((rows) => rows.filter((r) => r.id !== id));
  }

  protected unitsFor(current: string): string[] {
    return UNITS.includes(current) ? UNITS : [current, ...UNITS];
  }

  protected categoriesFor(current: string): string[] {
    const all = [...RECEIPT_CATEGORIES] as string[];
    return all.includes(current) ? all : [current, ...all];
  }

  private blankRow(): Row {
    return { id: this.nextId++, name: '', receiptText: null, qty: '1', unit: 'pcs', unitPrice: '', lineTotal: '', category: 'Other', suggestion: null };
  }

  // ---------- save ----------

  protected async save(event: Event): Promise<void> {
    event.preventDefault();
    this.message.set('');
    const receipt = this.toRequest();
    if (typeof receipt === 'string') {
      this.message.set(receipt);
      return;
    }
    this.saving.set(true);
    try {
      const saved = await firstValueFrom(this.api.saveReceipt(this.householdId(), receipt));
      this.toasts.show(`Saved the ${saved.storeName} receipt · ${saved.items.length} items · ${money(saved.total)}`);
      await this.router.navigate(['/prices/receipts', saved.id]);
    } catch (err) {
      this.message.set(errorMessage(err, 'Couldn’t save the receipt. Try again.'));
    } finally {
      this.saving.set(false);
    }
  }

  /** The request body, or a message saying what to fix. */
  private toRequest(): SaveReceipt | string {
    const store = this.store().trim();
    if (!store) return 'Enter the store name.';
    if (!this.date()) return 'Pick the date of the receipt.';
    const when = new Date(`${this.date()}T${this.time() || '12:00'}`);
    if (Number.isNaN(when.getTime())) return 'Check the date and time.';
    const rows = this.rows().filter((r) => r.name.trim() || r.lineTotal.trim());
    if (!rows.length) return 'Add at least one line.';
    const items = [];
    for (const [i, r] of rows.entries()) {
      const qty = parseAmount(r.qty);
      const price = parseAmount(r.unitPrice);
      const lineTotal = parseAmount(r.lineTotal);
      const n = i + 1;
      if (!r.name.trim()) return `Line ${n} needs an item name.`;
      if (!(qty > 0)) return `Line ${n} (${r.name.trim()}) needs a quantity above zero.`;
      if (!(lineTotal >= 0)) return `Line ${n} (${r.name.trim()}) needs a total.`;
      items.push({
        name: r.name.trim(),
        receiptText: r.receiptText,
        quantity: qty,
        unit: r.unit,
        unitPrice: price >= 0 ? price : round2(lineTotal / qty),
        lineTotal: round2(lineTotal),
        category: r.category,
      });
    }
    const optional = (text: string) => {
      const value = parseAmount(text);
      return value >= 0 ? round2(value) : null;
    };
    return {
      storeName: store,
      storeLocation: this.location().trim() || null,
      purchasedAt: when.toISOString(),
      subtotal: optional(this.subtotal()),
      tax: optional(this.tax()),
      total: optional(this.total()),
      items,
    };
  }
}
