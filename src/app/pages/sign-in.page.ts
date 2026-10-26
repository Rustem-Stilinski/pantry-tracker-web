import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';

import { errorMessage } from '../core/format';
import { Session } from '../core/session.service';

type Mode = 'sign-in' | 'register';

@Component({
  selector: 'app-sign-in-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule],
  template: `
    <div class="app narrow">
      <header class="top">
        <div class="brand">
          <h1>Used Items Log</h1>
          <p class="sub">Write down what gets used up and how much, so everyone can see what to restock.</p>
        </div>
      </header>

      <form class="slip" [formGroup]="form" (ngSubmit)="submit()" novalidate>
        <div class="tabs" role="tablist" aria-label="Account">
          <button type="button" role="tab" [attr.aria-selected]="mode() === 'sign-in'" (click)="setMode('sign-in')">Sign in</button>
          <button type="button" role="tab" [attr.aria-selected]="mode() === 'register'" (click)="setMode('register')">Create account</button>
        </div>
        <div class="slip-body">
          @if (mode() === 'register') {
            <div class="field">
              <label for="name">Your name</label>
              <input id="name" type="text" formControlName="displayName" autocomplete="name" maxlength="60" placeholder="Shown next to the entries you log">
            </div>
          }
          <div class="field">
            <label for="email">Email</label>
            <input id="email" type="email" formControlName="email" autocomplete="email" maxlength="254">
          </div>
          <div class="field">
            <label for="password">Password @if (mode() === 'register') { <span class="opt">at least 8 characters</span> }</label>
            <input id="password" type="password" formControlName="password"
                   [attr.autocomplete]="mode() === 'register' ? 'new-password' : 'current-password'" maxlength="100">
          </div>
          <button class="primary" type="submit" [disabled]="busy()">{{ mode() === 'register' ? 'Create account' : 'Sign in' }}</button>
          @if (message()) { <p class="form-msg" role="alert">{{ message() }}</p> }
        </div>
      </form>
    </div>
  `,
})
export class SignInPage {
  private readonly session = inject(Session);
  private readonly router = inject(Router);

  protected readonly mode = signal<Mode>('sign-in');
  protected readonly busy = signal(false);
  protected readonly message = signal('');

  protected readonly form = new FormGroup({
    displayName: new FormControl('', { nonNullable: true }),
    email: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.email] }),
    password: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
  });

  protected setMode(mode: Mode): void {
    this.mode.set(mode);
    this.message.set('');
  }

  protected async submit(): Promise<void> {
    const { displayName, email, password } = this.form.getRawValue();
    const registering = this.mode() === 'register';
    if (registering && !displayName.trim()) return this.message.set('Enter your name.');
    if (this.form.controls.email.invalid) return this.message.set('Enter a valid email address.');
    if (!password) return this.message.set('Enter your password.');
    if (registering && password.length < 8) return this.message.set('Use a password with at least 8 characters.');

    this.busy.set(true);
    this.message.set('');
    try {
      if (registering) await this.session.register(email.trim(), password, displayName.trim());
      else await this.session.signIn(email.trim(), password);
      await this.router.navigateByUrl(this.session.activeHouseholdId() ? '/' : '/household');
    } catch (err) {
      this.message.set(errorMessage(err, registering ? 'Couldn’t create the account. Try again.' : 'Couldn’t sign in. Try again.'));
    } finally {
      this.busy.set(false);
    }
  }
}
