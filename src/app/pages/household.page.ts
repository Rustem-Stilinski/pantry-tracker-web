import { ChangeDetectionStrategy, Component, WritableSignal, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { Api } from '../core/api.service';
import { errorMessage } from '../core/format';
import { Session } from '../core/session.service';

/** Start a new shared log, or join one with an invite code. */
@Component({
  selector: 'app-household-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, RouterLink],
  template: `
    <div class="app narrow">
      <header class="top">
        <div class="brand">
          <h1>Used Items Log</h1>
          <p class="sub">A log is shared by everyone who joins it: a home, an office, a team.</p>
        </div>
        @if (session.activeHouseholdId()) { <a routerLink="/" class="link-btn">Back to your log</a> }
      </header>

      <div class="setup">
        <form class="slip" [formGroup]="createForm" (ngSubmit)="create()" novalidate>
          <div class="slip-head"><h2>Start a log</h2></div>
          <div class="slip-body">
            <div class="field">
              <label for="log-name">Name</label>
              <input id="log-name" type="text" formControlName="name" maxlength="80" placeholder="e.g. Home, or 4th floor kitchen">
            </div>
            <button class="primary" type="submit" [disabled]="busy()">Start log</button>
            @if (createMessage()) { <p class="form-msg" role="alert">{{ createMessage() }}</p> }
          </div>
        </form>

        <form class="slip" [formGroup]="joinForm" (ngSubmit)="join()" novalidate>
          <div class="slip-head"><h2>Join a log</h2></div>
          <div class="slip-body">
            <div class="field">
              <label for="invite">Invite code</label>
              <input id="invite" type="text" formControlName="code" maxlength="32" autocomplete="off"
                     placeholder="e.g. K7QM-3XRP" class="mono-input">
            </div>
            <p class="hint">Ask someone already in the log for the code shown at the top of their page.</p>
            <button class="primary" type="submit" [disabled]="busy()">Join log</button>
            @if (joinMessage()) { <p class="form-msg" role="alert">{{ joinMessage() }}</p> }
          </div>
        </form>
      </div>
    </div>
  `,
})
export class HouseholdPage {
  protected readonly session = inject(Session);
  private readonly api = inject(Api);
  private readonly router = inject(Router);

  protected readonly createForm = new FormGroup({ name: new FormControl('', { nonNullable: true }) });
  protected readonly joinForm = new FormGroup({ code: new FormControl('', { nonNullable: true }) });
  protected readonly busy = signal(false);
  protected readonly createMessage = signal('');
  protected readonly joinMessage = signal('');

  protected async create(): Promise<void> {
    const name = this.createForm.controls.name.value.trim();
    if (!name) return this.createMessage.set('Give the log a name.');
    await this.run(this.createMessage, () => firstValueFrom(this.api.createHousehold(name)),
      'Couldn’t start the log. Try again.');
  }

  protected async join(): Promise<void> {
    const code = this.joinForm.controls.code.value.trim();
    if (!code) return this.joinMessage.set('Enter the invite code.');
    await this.run(this.joinMessage, () => firstValueFrom(this.api.joinHousehold(code)),
      'Couldn’t join with that code. Try again.');
  }

  private async run(message: WritableSignal<string>, action: () => Promise<{ id: string }>,
                    fallback: string): Promise<void> {
    this.busy.set(true);
    message.set('');
    try {
      const household = await action();
      await this.session.loadHouseholds();
      this.session.setActiveHousehold(household.id);
      await this.router.navigateByUrl('/');
    } catch (err) {
      message.set(errorMessage(err, fallback));
    } finally {
      this.busy.set(false);
    }
  }
}
