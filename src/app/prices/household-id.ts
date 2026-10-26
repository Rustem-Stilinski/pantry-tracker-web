import { inject } from '@angular/core';

import { Session } from '../core/session.service';

/** The open household's id. Prices routes are guarded by hasHousehold, so it is always set there. */
export function householdId(): () => string {
  const session = inject(Session);
  return () => session.activeHouseholdId() ?? '';
}

export const TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
