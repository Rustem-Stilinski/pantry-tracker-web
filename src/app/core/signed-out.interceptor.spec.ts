import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { Session } from './session.service';
import { signedOutInterceptor } from './signed-out.interceptor';

describe('signed out while the app is open', () => {
  const user = signal<{ id: string } | null>(null);
  let expired: number;
  let went: string[];
  let http: HttpClient;
  let backend: HttpTestingController;

  beforeEach(() => {
    expired = 0;
    went = [];
    user.set({ id: 'u1' });
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([signedOutInterceptor])),
        provideHttpClientTesting(),
        { provide: Session, useValue: { user, expire: () => { expired++; user.set(null); } } },
        { provide: Router, useValue: { navigateByUrl: async (url: string) => { went.push(url); return true; } } },
      ],
    });
    http = TestBed.inject(HttpClient);
    backend = TestBed.inject(HttpTestingController);
  });

  function call(url: string, status: number): void {
    http.get(url).subscribe({ error: () => undefined });
    backend.expectOne(url).flush(null, { status, statusText: 'x' });
  }

  it('goes to sign-in, once, when the server no longer knows the sign-in', () => {
    call('/api/households/h1/receipts?month=2026-11', 401);
    call('/api/households/h1/prices', 401);
    expect(expired).toBe(1);
    expect(went).toEqual(['/sign-in?expired=1']);
  });

  it('leaves the ordinary "not signed in" answers alone', () => {
    call('/api/auth/me', 401);
    call('/api/auth/login', 401);
    expect(expired).toBe(0);
    expect(went).toEqual([]);
  });

  it('ignores other errors, and 401s when nobody was signed in', () => {
    call('/api/households/h1/prices', 500);
    call('/api/households/h1/prices', 404);
    user.set(null);
    call('/api/households/h1/prices', 401);
    expect(expired).toBe(0);
    expect(went).toEqual([]);
  });
});
