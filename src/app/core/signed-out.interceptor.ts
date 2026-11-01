import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { EnvironmentInjector, inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';

import { Session } from './session.service';
import { Toasts } from './toast.service';

/** Calls where a 401 is an ordinary answer ("not signed in", "wrong password"), not a sign-in that ended. */
const AUTH_CALLS = ['/api/auth/me', '/api/auth/login', '/api/auth/register', '/api/auth/logout'];

/**
 * A 401 on any other call while we think someone is signed in means their sign-in ended (it expired, or
 * they signed out in another tab). Go to the sign-in page instead of showing empty lists.
 */
export const signedOutInterceptor: HttpInterceptorFn = (req, next) => {
  const injector = inject(EnvironmentInjector);
  return next(req).pipe(
    catchError((err: unknown) => {
      if (err instanceof HttpErrorResponse && err.status === 401 && !AUTH_CALLS.some((url) => req.url.startsWith(url))) {
        const session = injector.get(Session);
        if (session.user()) {
          session.expire();
          injector.get(Toasts).dismiss(); // an Undo for the old sign-in can't work any more
          void injector.get(Router).navigateByUrl('/sign-in?expired=1');
        }
      }
      return throwError(() => err);
    }),
  );
};
