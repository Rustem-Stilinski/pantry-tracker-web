import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { App } from './app';
import { Toasts } from './core/toast.service';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  it('shows a toast with an Undo button that runs the undo action', async () => {
    const fixture = TestBed.createComponent(App);
    const toasts = TestBed.inject(Toasts);
    let undone = false;

    toasts.show('Logged Milk · 1 carton', () => (undone = true));
    await fixture.whenStable();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.toast span')?.textContent).toBe('Logged Milk · 1 carton');

    (el.querySelector('.toast button') as HTMLButtonElement).click();
    await fixture.whenStable();

    expect(undone).toBe(true);
    expect(el.querySelector('.toast')).toBeNull();
  });
});
