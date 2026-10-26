import { ChangeDetectionStrategy, Component, ElementRef, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';

import { CATEGORIES, UNITS, itemKey, toLocalInputValue } from '../core/format';
import { LogStore } from './log.store';

/** The "Log a use" slip. */
@Component({
  selector: 'app-log-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule],
  template: `
    <form class="slip" [formGroup]="form" (ngSubmit)="submit()" novalidate>
      <div class="slip-head">
        <h2>Log a use</h2>
        <span class="label-caps">{{ today }}</span>
      </div>
      <div class="slip-body">
        <div class="field">
          <label for="item">Item</label>
          <input #itemInput id="item" type="text" formControlName="itemName" list="known-items"
                 autocomplete="off" maxlength="80" placeholder="e.g. Paper towels">
          <datalist id="known-items">
            @for (known of store.knownItems().values(); track known.itemName) {
              <option [value]="known.itemName"></option>
            }
          </datalist>
        </div>

        <div class="row2">
          <div class="field">
            <label for="qty">Amount</label>
            <div class="stepper">
              <button type="button" (click)="step(-1)" aria-label="Decrease amount">−</button>
              <input id="qty" type="number" formControlName="quantity" min="0" step="any" inputmode="decimal">
              <button type="button" (click)="step(1)" aria-label="Increase amount">+</button>
            </div>
          </div>
          <div class="field">
            <label for="unit">Unit</label>
            <input id="unit" type="text" formControlName="unit" list="units" maxlength="20" autocomplete="off">
            <datalist id="units">
              @for (u of units; track u) { <option [value]="u"></option> }
            </datalist>
          </div>
        </div>

        <fieldset class="field">
          <legend>Category</legend>
          <div class="chips">
            @for (c of categories; track c) {
              <label class="chip">
                <input type="radio" formControlName="category" [value]="c" [id]="'cat-' + c">
                <span>{{ c }}</span>
              </label>
            }
          </div>
        </fieldset>

        <fieldset class="field">
          <legend>When</legend>
          <div class="when-wrap">
            <div class="seg">
              <label class="chip"><input type="radio" formControlName="when" value="now" id="when-now"><span>Just now</span></label>
              <label class="chip"><input type="radio" formControlName="when" value="earlier" id="when-earlier"><span>Earlier</span></label>
            </div>
            @if (form.controls.when.value === 'earlier') {
              <input type="datetime-local" formControlName="usedAt" [max]="maxWhen()" aria-label="Date and time it was used">
            }
          </div>
        </fieldset>

        <div class="field">
          <label for="note">Note <span class="opt">optional</span></label>
          <input id="note" type="text" formControlName="note" maxlength="140" placeholder="e.g. Last one in the cupboard">
        </div>

        <button class="primary" type="submit" [disabled]="store.saving()">Log it</button>
        @if (message()) {
          <p class="form-msg" role="alert">{{ message() }}</p>
        }
      </div>
    </form>
  `,
})
export class LogForm {
  protected readonly store = inject(LogStore);
  protected readonly categories = CATEGORIES;
  protected readonly units = UNITS;
  protected readonly today = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date());
  protected readonly message = signal('');
  protected readonly maxWhen = signal(toLocalInputValue(new Date()));
  private readonly itemInput = viewChild.required<ElementRef<HTMLInputElement>>('itemInput');

  protected readonly form = new FormGroup({
    itemName: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    quantity: new FormControl<number | null>(1, { validators: [Validators.required, Validators.min(0.01)] }),
    unit: new FormControl('pcs', { nonNullable: true }),
    category: new FormControl<string>(CATEGORIES[0], { nonNullable: true }),
    when: new FormControl<'now' | 'earlier'>('now', { nonNullable: true }),
    usedAt: new FormControl('', { nonNullable: true }),
    note: new FormControl('', { nonNullable: true }),
  });

  constructor() {
    // Picking an item you've logged before fills in its usual unit and category.
    this.form.controls.itemName.valueChanges.pipe(takeUntilDestroyed()).subscribe((name) => {
      const known = this.store.knownItems().get(itemKey(name ?? ''));
      if (known) this.form.patchValue({ unit: known.unit, category: known.category }, { emitEvent: false });
    });
    this.form.controls.when.valueChanges.pipe(takeUntilDestroyed()).subscribe((when) => {
      if (when === 'earlier') {
        const now = new Date();
        this.maxWhen.set(toLocalInputValue(now));
        if (!this.form.controls.usedAt.value) {
          this.form.controls.usedAt.setValue(toLocalInputValue(new Date(now.getTime() - 3_600_000)));
        }
      }
    });
  }

  protected step(delta: number): void {
    const current = Number(this.form.controls.quantity.value) || 0;
    const next = current + delta;
    this.form.controls.quantity.setValue(next >= 1 ? Math.round(next * 100) / 100 : current);
  }

  protected async submit(): Promise<void> {
    this.message.set('');
    const v = this.form.getRawValue();
    const itemName = v.itemName.trim().replace(/\s+/g, ' ');
    if (!itemName) return this.fail('Name the item that was used.', 'item');
    const quantity = Number(v.quantity);
    if (!(quantity > 0)) return this.fail('Enter an amount above zero.', 'qty');

    let usedAt: string | undefined;
    if (v.when === 'earlier') {
      const when = new Date(v.usedAt);
      if (!v.usedAt || Number.isNaN(when.getTime())) return this.fail('Pick the date and time it was used.');
      if (when.getTime() > Date.now() + 60_000) return this.fail('That time hasn’t happened yet. Pick a time in the past.');
      usedAt = when.toISOString();
    }

    const ok = await this.store.add({
      itemName,
      quantity,
      unit: v.unit.trim() || 'pcs',
      category: v.category,
      note: v.note.trim() || null,
      usedAt,
    });
    if (ok) {
      this.form.reset({ itemName: '', quantity: 1, unit: 'pcs', category: v.category, when: 'now', usedAt: '', note: '' });
      this.itemInput().nativeElement.focus();
    }
  }

  private fail(message: string, focusId?: string): void {
    this.message.set(message);
    if (focusId) document.getElementById(focusId)?.focus();
  }
}
