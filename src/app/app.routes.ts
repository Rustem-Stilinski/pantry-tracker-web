import { Routes } from '@angular/router';

import { hasHousehold, signedInOnly, signedOutOnly } from './core/guards';

export const routes: Routes = [
  {
    path: 'sign-in',
    title: 'Sign in · Used Items Log',
    canActivate: [signedOutOnly],
    loadComponent: () => import('./pages/sign-in.page').then((m) => m.SignInPage),
  },
  {
    path: 'household',
    title: 'Start or join a log · Used Items Log',
    canActivate: [signedInOnly],
    loadComponent: () => import('./pages/household.page').then((m) => m.HouseholdPage),
  },
  {
    path: '',
    pathMatch: 'full',
    title: 'Used Items Log',
    canActivate: [signedInOnly, hasHousehold],
    loadComponent: () => import('./log/log.page').then((m) => m.LogPage),
  },
  { path: '**', redirectTo: '' },
];
