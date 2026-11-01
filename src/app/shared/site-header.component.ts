import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';

import { Session } from '../core/session.service';

/** App title, the signed-in person, and the switch between the two sections. */
@Component({
  selector: 'app-site-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterLinkActive],
  template: `
    <header class="top">
      <div class="brand">
        <h1>Pantry Tracker</h1>
        <p class="sub">{{ subtitle() }}</p>
      </div>
      <div class="account">
        <span class="who-me">{{ session.user()?.displayName }}</span>
        <button type="button" class="link-btn" (click)="signOut()">Sign out</button>
      </div>
    </header>
    <nav class="section-nav" aria-label="Sections">
      <a routerLink="/" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }"
         ariaCurrentWhenActive="page">Used items</a>
      <a routerLink="/prices" routerLinkActive="active" ariaCurrentWhenActive="page">Prices</a>
      <a routerLink="/scan" routerLinkActive="active" ariaCurrentWhenActive="page" class="scan-link">
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
          <path d="M3 7V4h3M18 4h3v3M21 17v3h-3M6 20H3v-3" fill="none" stroke="currentColor" stroke-width="2"/>
          <path d="M7 8v8M10 8v8M12.5 8v8M15 8v8M17 8v8" fill="none" stroke="currentColor" stroke-width="1.6"/>
        </svg>
        Scan
      </a>
    </nav>
  `,
  host: { class: 'site-header' },
})
export class SiteHeader {
  readonly subtitle = input('');
  protected readonly session = inject(Session);
  private readonly router = inject(Router);

  protected async signOut(): Promise<void> {
    await this.session.signOut();
    await this.router.navigateByUrl('/sign-in');
  }
}
