import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { Session } from './session.service';

// Note: inject() only works before the first `await`, so each guard grabs what it needs up front.

/** Pages that need a signed-in person. */
export const signedInOnly: CanActivateFn = async () => {
  const session = inject(Session);
  const router = inject(Router);
  await session.ensureLoaded();
  return session.user() ? true : router.parseUrl('/sign-in');
};

/** The sign-in page; signed-in people go straight to their log. */
export const signedOutOnly: CanActivateFn = async () => {
  const session = inject(Session);
  const router = inject(Router);
  await session.ensureLoaded();
  return session.user() ? router.parseUrl('/') : true;
};

/** The log page needs a household; people without one start or join one first. */
export const hasHousehold: CanActivateFn = async () => {
  const session = inject(Session);
  const router = inject(Router);
  await session.ensureLoaded();
  return session.activeHouseholdId() ? true : router.parseUrl('/household');
};
