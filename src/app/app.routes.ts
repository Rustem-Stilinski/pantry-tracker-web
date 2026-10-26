import { Routes } from '@angular/router';

import { hasHousehold, signedInOnly, signedOutOnly } from './core/guards';

export const routes: Routes = [
  {
    path: 'sign-in',
    title: 'Sign in · Pantry Tracker',
    canActivate: [signedOutOnly],
    loadComponent: () => import('./pages/sign-in.page').then((m) => m.SignInPage),
  },
  {
    path: 'household',
    title: 'Start or join a log · Pantry Tracker',
    canActivate: [signedInOnly],
    loadComponent: () => import('./pages/household.page').then((m) => m.HouseholdPage),
  },
  {
    path: '',
    pathMatch: 'full',
    title: 'Used items · Pantry Tracker',
    canActivate: [signedInOnly, hasHousehold],
    loadComponent: () => import('./log/log.page').then((m) => m.LogPage),
  },
  {
    path: 'prices',
    canActivate: [signedInOnly, hasHousehold],
    loadComponent: () => import('./prices/prices.shell').then((m) => m.PricesShell),
    children: [
      {
        path: '',
        title: 'Prices · Pantry Tracker',
        loadComponent: () => import('./prices/items.page').then((m) => m.ItemsPage),
      },
      {
        path: 'item',
        title: 'Price history · Pantry Tracker',
        loadComponent: () => import('./prices/item.page').then((m) => m.ItemPage),
      },
      {
        path: 'compare',
        title: 'Compare stores · Pantry Tracker',
        loadComponent: () => import('./prices/compare.page').then((m) => m.ComparePage),
      },
      {
        path: 'receipts',
        title: 'Receipts · Pantry Tracker',
        loadComponent: () => import('./prices/receipts.page').then((m) => m.ReceiptsPage),
      },
      {
        path: 'receipts/new',
        title: 'Add a receipt · Pantry Tracker',
        loadComponent: () => import('./prices/add-receipt.page').then((m) => m.AddReceiptPage),
      },
      {
        path: 'receipts/:id',
        title: 'Receipt · Pantry Tracker',
        loadComponent: () => import('./prices/receipt.page').then((m) => m.ReceiptPage),
      },
      {
        path: 'spending',
        title: 'Spending · Pantry Tracker',
        loadComponent: () => import('./prices/spending.page').then((m) => m.SpendingPage),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
