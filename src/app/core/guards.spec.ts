import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree, provideRouter } from '@angular/router';

import { hasHousehold, signedInOnly, signedOutOnly } from './guards';
import { Session } from './session.service';

/** Guards await the session before deciding, so they must not call inject() after awaiting. */
describe('route guards', () => {
  const session = {
    user: () => null as unknown,
    activeHouseholdId: () => null as string | null,
    ensureLoaded: () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: Session, useValue: session }],
    });
  });

  const run = (guard: typeof signedInOnly) =>
    TestBed.runInInjectionContext(() =>
      guard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot)) as Promise<boolean | UrlTree>;

  const path = (result: boolean | UrlTree) =>
    result instanceof UrlTree ? TestBed.inject(Router).serializeUrl(result) : result;

  it('sends signed-out people to sign-in', async () => {
    session.user = () => null;
    expect(path(await run(signedInOnly))).toBe('/sign-in');
    expect(path(await run(signedOutOnly))).toBe(true);
  });

  it('sends people without a log to the start/join page', async () => {
    session.user = () => ({ id: 'u1' });
    session.activeHouseholdId = () => null;
    expect(path(await run(signedInOnly))).toBe(true);
    expect(path(await run(signedOutOnly))).toBe('/');
    expect(path(await run(hasHousehold))).toBe('/household');
  });
});
