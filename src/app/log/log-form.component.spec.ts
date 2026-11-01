import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { UNITS } from '../core/format';
import { NewEntry } from '../core/models';
import { LogForm } from './log-form.component';
import { KnownItem, LogStore } from './log.store';

describe('LogForm unit dropdown', () => {
  let added: NewEntry[];
  const known = signal(new Map<string, KnownItem>());

  beforeEach(async () => {
    added = [];
    known.set(new Map([['honey', { itemName: 'Honey', unit: 'jar', category: 'Pantry' }]]));
    await TestBed.configureTestingModule({
      imports: [LogForm],
      providers: [{
        provide: LogStore,
        useValue: {
          knownItems: known,
          saving: signal(false),
          add: async (entry: NewEntry) => { added.push(entry); return true; },
        },
      }],
    }).compileComponents();
  });

  async function render() {
    const fixture = TestBed.createComponent(LogForm);
    await fixture.whenStable();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  function type(input: HTMLInputElement, value: string) {
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }

  function choose(select: HTMLSelectElement, value: string) {
    select.value = value;
    select.dispatchEvent(new Event('change'));
  }

  it('offers every unit even while one is selected', async () => {
    const { el } = await render();
    const select = el.querySelector('#unit') as HTMLSelectElement;
    const values = [...select.options].map((o) => o.value);
    expect(select.value).toBe('pcs');
    for (const unit of UNITS) expect(values).toContain(unit);
    expect([...select.querySelectorAll('optgroup')].map((g) => g.label)).toEqual(['Count', 'Weight', 'Volume']);
  });

  it('logs a unit picked from the list', async () => {
    const { fixture, el } = await render();
    type(el.querySelector('#item') as HTMLInputElement, 'Flour');
    choose(el.querySelector('#unit') as HTMLSelectElement, 'lb');
    (el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    expect(added[0]).toMatchObject({ itemName: 'Flour', unit: 'lb', quantity: 1 });
  });

  it('logs a custom unit typed under "Other…"', async () => {
    const { fixture, el } = await render();
    type(el.querySelector('#item') as HTMLInputElement, 'Olives');
    choose(el.querySelector('#unit') as HTMLSelectElement, '__other__');
    await fixture.whenStable();
    type(el.querySelector('#custom-unit') as HTMLInputElement, 'jar');
    (el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    expect(added[0]).toMatchObject({ itemName: 'Olives', unit: 'jar' });
  });

  it('refills a remembered custom unit under "Other…"', async () => {
    const { fixture, el } = await render();
    type(el.querySelector('#item') as HTMLInputElement, 'honey');
    await fixture.whenStable();
    expect((el.querySelector('#unit') as HTMLSelectElement).value).toBe('__other__');
    expect((el.querySelector('#custom-unit') as HTMLInputElement).value).toBe('jar');
  });
});

describe('LogForm filled in from a scan', () => {
  const known = signal(new Map<string, KnownItem>());

  beforeEach(async () => {
    known.set(new Map());
    await TestBed.configureTestingModule({
      imports: [LogForm],
      providers: [{
        provide: LogStore,
        useValue: { knownItems: known, saving: signal(false), add: async () => true },
      }],
    }).compileComponents();
  });

  it('fills in the item, then its usual unit and category once the log has loaded', async () => {
    const fixture = TestBed.createComponent(LogForm);
    fixture.componentRef.setInput('preset', 'Honey');
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect((el.querySelector('#item') as HTMLInputElement).value).toBe('Honey');
    expect((el.querySelector('#unit') as HTMLSelectElement).value).toBe('pcs');

    known.set(new Map([['honey', { itemName: 'Honey', unit: 'jar', category: 'Pantry' }]]));
    await fixture.whenStable();
    expect((el.querySelector('#unit') as HTMLSelectElement).value).toBe('__other__');
    expect((el.querySelector('#custom-unit') as HTMLInputElement).value).toBe('jar');
    expect((el.querySelector('#cat-Pantry') as HTMLInputElement).checked).toBe(true);
  });

  it('leaves a unit the person already picked alone', async () => {
    const fixture = TestBed.createComponent(LogForm);
    fixture.componentRef.setInput('preset', 'Honey');
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const unit = el.querySelector('#unit') as HTMLSelectElement;
    unit.value = 'bottle';
    unit.dispatchEvent(new Event('change'));

    known.set(new Map([['honey', { itemName: 'Honey', unit: 'jar', category: 'Pantry' }]]));
    await fixture.whenStable();
    expect(unit.value).toBe('bottle');
  });
});
