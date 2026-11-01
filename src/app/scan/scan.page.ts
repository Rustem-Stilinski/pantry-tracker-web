import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { Api } from '../core/api.service';
import { closestItems, displayBarcode, typedBarcode } from '../core/barcode';
import { errorMessage, itemKey, relativeDay } from '../core/format';
import { BarcodeLookup } from '../core/models';
import { unitPrice } from '../core/money';
import { householdId } from '../prices/household-id';
import { SiteHeader } from '../shared/site-header.component';
import { FoundBarcode } from './barcode-reader';
import { BarcodeScanner } from './barcode-scanner.component';

/**
 * Scan a product's barcode: /scan opens the camera; /scan?code=… shows what it is. A barcode the log has
 * named shows its prices and a one-tap "Log a use"; a new one is named once, ideally after its receipt name.
 */
@Component({
  selector: 'app-scan-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, SiteHeader, BarcodeScanner],
  template: `
    <div class="app narrow">
      <app-site-header subtitle="Scan a product to see what it cost and where it’s cheapest, or to log that it ran out." />

      @if (!code()) {
        <section class="slip scan-slip" aria-labelledby="scan-title">
          <div class="slip-head"><h2 id="scan-title">Scan a barcode</h2></div>
          <div class="slip-body">
            <app-barcode-scanner (detected)="open($event)" />
            <form class="typed-code" (submit)="lookUpTyped($event)" novalidate>
              <label for="typed-code">Or type the number under the bars</label>
              <div class="typed-row">
                <input id="typed-code" type="text" inputmode="numeric" autocomplete="off" maxlength="20"
                       placeholder="e.g. 0 41303 01234 5" [value]="typed()" (input)="typed.set($any($event.target).value)">
                <button class="secondary" type="submit">Look up</button>
              </div>
              @if (typedError()) {
                <p class="form-msg" role="alert">{{ typedError() }}</p>
              }
            </form>
          </div>
        </section>
      } @else {
        <section class="slip scan-result" aria-labelledby="result-title" aria-live="polite">
          <div class="slip-head">
            <h2 id="result-title">{{ heading() }}</h2>
            <span class="label-caps barcode-digits">{{ shownCode() }}</span>
          </div>
          <div class="slip-body">
            @if (loadError()) {
              <p class="form-msg" role="alert">{{ loadError() }}</p>
              <div class="scan-actions">
                <button type="button" class="primary btn-small" (click)="scanAnother()">Scan again</button>
              </div>
            } @else if (!lookup()) {
              <p class="loading">Looking it up…</p>
            } @else if (lookup()!.known && !renaming()) {
              @let l = lookup()!;
              <p class="scan-name">{{ l.itemName }}</p>
              @if (l.prices; as p) {
                <dl class="stat-row">
                  <div>
                    <dt>Latest</dt>
                    <dd>{{ price(p.latestPrice, p.unit) }}</dd>
                    <small>{{ p.latestStore }} · {{ day(p.latestAt) }}</small>
                  </div>
                  <div>
                    <dt>Lowest</dt>
                    <dd>{{ price(p.lowestPrice, p.unit) }}</dd>
                    <small>
                      {{ p.lowestStore }} · {{ day(p.lowestAt) }}
                      @if (p.lowestPrice < p.latestPrice) { <span class="chip-good">Cheapest</span> }
                    </small>
                  </div>
                </dl>
                <a class="link-btn" routerLink="/prices/item" [queryParams]="{ item: p.itemName, unit: p.unit }">
                  Price history and stores ›
                </a>
              } @else {
                <p class="hint">No receipt has “{{ l.itemName }}” on it yet. Its prices show up here once one does.</p>
              }
              <div class="scan-actions">
                <a class="primary btn-small" routerLink="/" [queryParams]="{ item: l.itemName }">Log a use</a>
                <button type="button" class="secondary btn-small" (click)="scanAnother()">Scan another</button>
              </div>
              <button type="button" class="link-btn scan-rename" (click)="rename()">Wrong item? Rename this barcode</button>
            } @else {
              @let l = lookup()!;
              @if (!l.known) {
                <p class="hint">New to your log. Name it once and anyone in the log can scan it.</p>
              }
              @if (l.suggestion; as s) {
                <div class="suggest">
                  <span class="label-caps">From {{ s.source }}</span>
                  <button type="button" class="filter" [attr.aria-pressed]="name() === s.name" (click)="name.set(s.name)">
                    {{ s.name }}
                  </button>
                </div>
              }
              @if (matches().length) {
                <div class="suggest">
                  <span class="label-caps">On your receipts</span>
                  <div class="chips">
                    @for (m of matches(); track m) {
                      <button type="button" class="filter" [attr.aria-pressed]="name() === m" (click)="name.set(m)">{{ m }}</button>
                    }
                  </div>
                </div>
              }
              <form class="name-form" (submit)="save($event)" novalidate>
                <div class="field">
                  <label for="barcode-name">Item</label>
                  <input id="barcode-name" type="text" list="barcode-known-items" maxlength="80" autocomplete="off"
                         placeholder="e.g. Milk 2%, 1 gal" [value]="name()" (input)="name.set($any($event.target).value)">
                  <datalist id="barcode-known-items">
                    @for (n of knownNames(); track n) { <option [value]="n"></option> }
                  </datalist>
                  <p class="hint">Use the name it has on your receipts to see its prices here.</p>
                </div>
                <div class="scan-actions">
                  <button class="primary btn-small" type="submit" [disabled]="saving()">Save</button>
                  @if (renaming()) {
                    <button type="button" class="secondary btn-small" (click)="renaming.set(false)">Cancel</button>
                  } @else {
                    <button type="button" class="secondary btn-small" (click)="scanAnother()">Scan another</button>
                  }
                </div>
                @if (saveError()) {
                  <p class="form-msg" role="alert">{{ saveError() }}</p>
                }
              </form>
            }
          </div>
        </section>
      }
    </div>
  `,
})
export class ScanPage {
  /** From the query string: /scan?code=036000291452&format=upc_a */
  readonly code = input<string>();
  readonly format = input<string>();

  private readonly api = inject(Api);
  private readonly router = inject(Router);
  private readonly householdId = householdId();

  protected readonly typed = signal('');
  protected readonly typedError = signal('');
  protected readonly lookup = signal<BarcodeLookup | null>(null);
  protected readonly loadError = signal('');
  protected readonly renaming = signal(false);
  protected readonly name = signal('');
  protected readonly saving = signal(false);
  protected readonly saveError = signal('');
  protected readonly knownNames = signal<string[]>([]);

  protected readonly heading = computed(() => {
    const l = this.lookup();
    if (!l) return 'Scanned';
    if (this.renaming()) return 'Rename';
    return l.known ? 'Scanned' : 'New barcode';
  });
  protected readonly shownCode = computed(() => displayBarcode(this.lookup()?.code ?? this.code() ?? ''));
  /** Receipt items that look like the suggested product, so the barcode can be linked to their prices. */
  protected readonly matches = computed(() => {
    const suggestion = this.lookup()?.suggestion?.name;
    return suggestion ? closestItems(suggestion, this.knownNames()) : [];
  });

  private requestSeq = 0;
  private namesLoaded = false;

  constructor() {
    effect(() => {
      const code = this.code();
      const format = this.format();
      untracked(() => void this.load(code, format));
    });
  }

  protected open(found: FoundBarcode): void {
    void this.router.navigate(['/scan'], { queryParams: { code: found.code, format: found.format } });
  }

  protected lookUpTyped(event: Event): void {
    event.preventDefault();
    const code = typedBarcode(this.typed());
    if (!code) {
      this.typedError.set('Type all the digits under the bars: 12 or 13 on most products, 8 on small ones.');
      return;
    }
    this.typedError.set('');
    void this.router.navigate(['/scan'], { queryParams: { code } });
  }

  protected scanAnother(): void {
    void this.router.navigate(['/scan']);
  }

  protected rename(): void {
    this.name.set(this.lookup()?.itemName ?? '');
    this.saveError.set('');
    this.renaming.set(true);
    void this.loadKnownNames();
  }

  protected async save(event: Event): Promise<void> {
    event.preventDefault();
    const lookup = this.lookup();
    const name = this.name().trim().replace(/\s+/g, ' ');
    if (!lookup) return;
    if (!name) {
      this.saveError.set('Name the item, or pick one of the suggestions.');
      document.getElementById('barcode-name')?.focus();
      return;
    }
    this.saving.set(true);
    this.saveError.set('');
    try {
      this.lookup.set(await firstValueFrom(this.api.saveBarcode(this.householdId(), lookup.code, name)));
      this.renaming.set(false);
    } catch (err) {
      this.saveError.set(errorMessage(err, 'Couldn’t save that. Try again.'));
    } finally {
      this.saving.set(false);
    }
  }

  protected price(value: number, unit: string): string {
    return unitPrice(value, unit);
  }

  protected day(iso: string): string {
    return relativeDay(new Date(iso));
  }

  private async load(code: string | undefined, format: string | undefined): Promise<void> {
    const seq = ++this.requestSeq;
    this.lookup.set(null);
    this.loadError.set('');
    this.renaming.set(false);
    this.saveError.set('');
    this.typed.set('');
    if (!code) return;
    try {
      const found = await firstValueFrom(this.api.barcode(this.householdId(), code, format));
      if (seq !== this.requestSeq) return;
      this.lookup.set(found);
      if (!found.known) {
        this.name.set(found.suggestion?.name ?? '');
        void this.loadKnownNames();
      }
    } catch (err) {
      if (seq !== this.requestSeq) return;
      this.loadError.set(errorMessage(err, 'That barcode didn’t load. Check your connection and try again.'));
    }
  }

  /** Item names from receipts and the used-items log, for suggestions and autocomplete. */
  private async loadKnownNames(): Promise<void> {
    if (this.namesLoaded) return;
    this.namesLoaded = true;
    const id = this.householdId();
    const [prices, frequent] = await Promise.allSettled([
      firstValueFrom(this.api.prices(id)),
      firstValueFrom(this.api.frequent(id, 50)),
    ]);
    const names = new Map<string, string>();
    if (prices.status === 'fulfilled') for (const it of prices.value.items) names.set(itemKey(it.itemName), it.itemName);
    if (frequent.status === 'fulfilled') {
      for (const f of frequent.value) if (!names.has(itemKey(f.itemName))) names.set(itemKey(f.itemName), f.itemName);
    }
    if (prices.status === 'rejected' && frequent.status === 'rejected') this.namesLoaded = false;
    this.knownNames.set([...names.values()].sort((a, b) => a.localeCompare(b)));
  }
}
