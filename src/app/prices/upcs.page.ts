import { ChangeDetectionStrategy, Component, computed, inject, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { Api } from '../core/api.service';
import { barcodeLabel, displayBarcode, typedBarcode, typedBarcodeProblem } from '../core/barcode';
import { errorMessage, itemKey, relativeDay } from '../core/format';
import { ItemPrice } from '../core/models';
import { Toasts } from '../core/toast.service';
import { FoundBarcode } from '../scan/barcode-reader';
import { BarcodeScanner } from '../scan/barcode-scanner.component';
import { householdId } from './household-id';

/** Sold by weight (bananas, deli): these carry a store sticker, not a UPC. */
const WEIGHED = new Set(['lb', 'lbs', 'oz', 'kg', 'g']);
/** Fees and deposits on receipts: nothing to scan. */
const NOT_A_PRODUCT = /\b(fee|deposit|charge)s?\b/i;

/** The UPC that was just scanned belongs to another item. */
interface Conflict {
  code: string;
  scanned: string;
  itemName: string;
}

/** The items linked to UPCs so far, and their codes, by item key. */
type CodesByItem = ReadonlyMap<string, readonly string[]>;

/**
 * Link UPCs: every receipt item without a UPC, newest first. Tap one and scan the product; the next item is
 * ready straight away with the camera still on, so a whole trip can be linked while putting groceries away.
 */
@Component({
  selector: 'app-upcs-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, BarcodeScanner],
  template: `
    <div class="item-head">
      <h2 class="page-title">Link UPCs</h2>
      <p class="hint">Scan each product once; after that, scanning it shows its prices. Items sold by weight, like
        bananas, have no UPC and aren’t listed.</p>
    </div>

    @if (error()) {
      <div class="empty"><strong>Items didn’t load</strong><p>{{ error() }}</p></div>
    } @else if (!loaded()) {
      <p class="loading">Loading items…</p>
    } @else {
      @if (current(); as item) {
        <section class="slip link-slip" aria-labelledby="link-title">
          <div class="slip-head">
            <h2 id="link-title">Scan the UPC of</h2>
            <span class="label-caps">{{ unlinked().length }} left</span>
          </div>
          <div class="slip-body">
            <div class="link-target" aria-live="polite">
              <p class="scan-name">{{ item.itemName }}</p>
              <small class="muted">{{ item.category }} · {{ item.latestStore }} · {{ day(item.latestAt) }}</small>
            </div>
            @if (conflict(); as c) {
              <div class="notice link-conflict" role="alert">
                <p>{{ label(c.code) }} {{ show(c.code) }} is already linked to <strong>{{ c.itemName }}</strong>.</p>
                <div class="scan-actions">
                  <button type="button" class="primary btn-small" (click)="moveHere(c)" [disabled]="busy()">
                    Link it to {{ item.itemName }} instead
                  </button>
                  <button type="button" class="secondary btn-small" (click)="keepConflict(c)">Keep it there</button>
                </div>
              </div>
            }
            <app-barcode-scanner [continuous]="true" [ignore]="ignored()" (detected)="onScan($event)" />
            <form class="typed-code" (submit)="lookUpTyped($event)" novalidate>
              <label for="link-typed">Or type the number under the bars</label>
              <div class="typed-row">
                <input id="link-typed" type="text" inputmode="numeric" autocomplete="off" maxlength="24"
                       placeholder="All 12 digits, e.g. 0 36000 29145 2"
                       [value]="typed()" (input)="typed.set($any($event.target).value)">
                <button class="secondary" type="submit" [disabled]="busy()">Link</button>
              </div>
            </form>
            @if (message()) {
              <p class="form-msg" role="alert">{{ message() }}</p>
            }
            <div class="scan-actions">
              <button type="button" class="secondary btn-small" (click)="skip()">Skip this one</button>
              <button type="button" class="secondary btn-small" (click)="stop()">Done</button>
            </div>
          </div>
        </section>
      }

      <section class="block" aria-labelledby="unlinked-title">
        <h3 class="label-caps" id="unlinked-title">{{ unlinked().length }} without a UPC · newest first</h3>
        <div class="upc-list">
          @for (it of unlinked(); track it.itemKey) {
            <div class="upc-item" [class.current]="current()?.itemKey === it.itemKey">
              <span class="p-item"><strong>{{ it.itemName }}</strong>
                <small>{{ it.category }} · {{ it.latestStore }} · {{ day(it.latestAt) }}</small></span>
              <button type="button" class="secondary btn-small" (click)="begin(it)"
                      [attr.aria-label]="'Scan the UPC of ' + it.itemName">Scan</button>
            </div>
          } @empty {
            <p class="empty-mini">Every item from your receipts has a UPC.</p>
          }
        </div>
      </section>

      @if (linked().length) {
        <section class="block" aria-labelledby="linked-title">
          <h3 class="label-caps" id="linked-title">{{ linked().length }} with a UPC</h3>
          <div class="upc-list">
            @for (it of linked(); track it.itemKey) {
              <a class="upc-item" routerLink="/prices/item" [queryParams]="{ item: it.itemName, unit: it.unit }">
                <span class="p-item"><strong>{{ it.itemName }}</strong><small>{{ it.category }}</small></span>
                <span class="upc-codes">
                  @for (code of codesOf(it); track code) { <code>{{ show(code) }}</code> }
                </span>
              </a>
            }
          </div>
        </section>
      }
    }
  `,
})
export class UpcsPage {
  private readonly api = inject(Api);
  private readonly toasts = inject(Toasts);
  private readonly householdId = householdId();
  private readonly scanner = viewChild(BarcodeScanner);

  protected readonly loaded = signal(false);
  protected readonly error = signal('');
  /** Receipt items that can have a UPC, one per item, newest purchase first. */
  protected readonly items = signal<ItemPrice[]>([]);
  protected readonly codes = signal<CodesByItem>(new Map());
  protected readonly current = signal<ItemPrice | null>(null);
  protected readonly conflict = signal<Conflict | null>(null);
  /** Codes linked here already: still in front of the camera, so look past them. */
  protected readonly ignored = signal<ReadonlySet<string>>(new Set());
  protected readonly typed = signal('');
  protected readonly message = signal('');
  protected readonly busy = signal(false);
  private readonly skipped = new Set<string>();

  protected readonly unlinked = computed(() => this.items().filter((it) => !this.codes().has(it.itemKey)));
  protected readonly linked = computed(() => this.items().filter((it) => this.codes().has(it.itemKey)));

  protected readonly show = displayBarcode;
  protected readonly label = barcodeLabel;

  constructor() {
    void this.load();
  }

  protected day(iso: string): string {
    return relativeDay(new Date(iso));
  }

  protected codesOf(item: ItemPrice): readonly string[] {
    return this.codes().get(item.itemKey) ?? [];
  }

  protected begin(item: ItemPrice): void {
    this.skipped.delete(item.itemKey);
    this.current.set(item);
    this.resetPrompt();
    this.scanner()?.resume();
  }

  protected skip(): void {
    const item = this.current();
    if (item) this.skipped.add(item.itemKey);
    this.next();
  }

  protected stop(): void {
    this.current.set(null);
    this.resetPrompt();
  }

  protected lookUpTyped(event: Event): void {
    event.preventDefault();
    const code = typedBarcode(this.typed());
    if (!code) {
      this.message.set(typedBarcodeProblem(this.typed()));
      return;
    }
    void this.onScan({ code, format: '' });
  }

  /** A barcode for the current item: link it, or ask first if it belongs to another item. */
  protected async onScan(found: FoundBarcode): Promise<void> {
    const item = this.current();
    if (!item || this.busy()) return;
    this.busy.set(true);
    this.message.set('');
    const id = this.householdId();
    try {
      const lookup = await firstValueFrom(this.api.barcode(id, found.code, found.format || undefined));
      if (lookup.known && itemKey(lookup.itemName ?? '') !== item.itemKey) {
        this.conflict.set({ code: lookup.code, scanned: found.code, itemName: lookup.itemName ?? '' });
        return;
      }
      if (!lookup.known) await firstValueFrom(this.api.saveBarcode(id, lookup.code, item.itemName));
      this.linkedHere(item, lookup.code, found.code);
    } catch (err) {
      this.message.set(errorMessage(err, 'Couldn’t link that UPC. Try again.'));
      this.scanner()?.resume();
    } finally {
      this.busy.set(false);
    }
  }

  protected async moveHere(conflict: Conflict): Promise<void> {
    const item = this.current();
    if (!item) return;
    this.busy.set(true);
    try {
      await firstValueFrom(this.api.saveBarcode(this.householdId(), conflict.code, item.itemName));
      this.codes.update((all) => withoutCode(all, conflict.code));
      this.linkedHere(item, conflict.code, conflict.scanned);
    } catch (err) {
      this.message.set(errorMessage(err, 'Couldn’t move that UPC. Try again.'));
    } finally {
      this.busy.set(false);
    }
  }

  /** Leaves the UPC on its item and looks for this item's own barcode. */
  protected keepConflict(conflict: Conflict): void {
    this.conflict.set(null);
    this.ignored.update((set) => new Set([...set, conflict.scanned]));
    this.scanner()?.resume();
  }

  private linkedHere(item: ItemPrice, code: string, scanned: string): void {
    this.codes.update((all) => {
      const next = new Map(all);
      const codes = next.get(item.itemKey) ?? [];
      if (!codes.includes(code)) next.set(item.itemKey, [...codes, code]);
      return next;
    });
    this.ignored.update((set) => new Set([...set, scanned, code]));
    this.toasts.show(`Linked ${barcodeLabel(code)} ${displayBarcode(code)} to ${item.itemName}`, () => {
      void firstValueFrom(this.api.unlinkBarcode(this.householdId(), code))
        .then(() => this.codes.update((all) => withoutCode(all, code)))
        .catch(() => this.toasts.show('Couldn’t undo that. Remove it from the item’s page.'));
    });
    this.next();
  }

  /** The next item without a UPC after the current one, leaving out skipped ones; the camera stays on. */
  private next(): void {
    const all = this.items();
    const waiting = new Set(this.unlinked().map((it) => it.itemKey));
    const at = all.findIndex((it) => it.itemKey === this.current()?.itemKey);
    const order = at >= 0 ? [...all.slice(at + 1), ...all.slice(0, at + 1)] : all;
    const upcoming = order.find((it) => waiting.has(it.itemKey) && !this.skipped.has(it.itemKey)) ?? null;
    this.current.set(upcoming);
    this.resetPrompt();
    if (upcoming) this.scanner()?.resume();
  }

  private resetPrompt(): void {
    this.conflict.set(null);
    this.message.set('');
    this.typed.set('');
  }

  private async load(): Promise<void> {
    const id = this.householdId();
    try {
      const [overview, barcodes] = await Promise.all([
        firstValueFrom(this.api.prices(id)),
        firstValueFrom(this.api.allBarcodes(id)),
      ]);
      const byKey = new Map<string, ItemPrice>();
      for (const it of overview.items) {
        if (WEIGHED.has(it.unit.toLowerCase()) || NOT_A_PRODUCT.test(it.itemName)) continue;
        const seen = byKey.get(it.itemKey);
        if (!seen || it.latestAt > seen.latestAt) byKey.set(it.itemKey, it);
      }
      this.items.set([...byKey.values()].sort((a, b) => b.latestAt.localeCompare(a.latestAt)));
      const codes = new Map<string, string[]>();
      for (const b of barcodes) {
        const key = itemKey(b.itemName);
        codes.set(key, [...(codes.get(key) ?? []), b.code]);
      }
      this.codes.set(codes);
      this.loaded.set(true);
    } catch (err) {
      this.error.set(errorMessage(err, 'Reload the page to try again.'));
    }
  }
}

function withoutCode(all: CodesByItem, code: string): CodesByItem {
  const next = new Map<string, readonly string[]>();
  for (const [key, codes] of all) {
    const rest = codes.filter((c) => c !== code);
    if (rest.length) next.set(key, rest);
  }
  return next;
}
