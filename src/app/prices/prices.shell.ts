import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

import { SiteHeader } from '../shared/site-header.component';

/** Frame for every Prices page: header, the four views, and the Add receipt button. */
@Component({
  selector: 'app-prices-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, SiteHeader],
  template: `
    <div class="app">
      <app-site-header subtitle="Snap your receipts to see what things cost, where they're cheapest, and what you spend." />
      <div class="prices-bar">
        <nav class="sub-nav" aria-label="Prices">
          <a routerLink="/prices" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }"
             ariaCurrentWhenActive="page">Items</a>
          <a routerLink="/prices/compare" routerLinkActive="active" ariaCurrentWhenActive="page">Compare stores</a>
          <a routerLink="/prices/receipts" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }"
             ariaCurrentWhenActive="page">Receipts</a>
          <a routerLink="/prices/spending" routerLinkActive="active" ariaCurrentWhenActive="page">Spending</a>
        </nav>
        <a class="primary btn-small" routerLink="/prices/receipts/new">Add receipt</a>
      </div>
      <router-outlet />
    </div>
  `,
})
export class PricesShell {}
