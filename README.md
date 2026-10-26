# pantry-tracker-web

Web app for **Used Items Log**: a shared log of things that get used up (paper towels, coffee pods,
printer paper), with monthly totals so you know what to restock. Several people share one log by
joining it with an invite code.

The REST API lives in [pantry-tracker-api](https://github.com/Rustem-Stilinski/pantry-tracker-api).

**Stack:** Angular 22 (standalone components, signals, zoneless), plain CSS, Vitest.

```
src/app/
├── core/     API client, session, route guards, formatting helpers
├── log/      the main page: log form, quick repeats, totals, entries by day
├── pages/    sign-in and start/join a log
└── shared/   tally-mark component
```

## Run

Needs Node 22+ and the API running on http://localhost:8080 (see
[pantry-tracker-api](https://github.com/Rustem-Stilinski/pantry-tracker-api)).

```bash
npm install
npm start        # http://localhost:4200
```

The dev server forwards `/api` to `localhost:8080` (`proxy.conf.json`), so the browser sees one
origin and the session and CSRF cookies work as they will in production.

## Tests and build

```bash
npm test -- --watch=false   # Vitest unit tests
npx ng build                # production build in dist/frontend/browser
```

## Docker

The image serves the built app with nginx and forwards `/api` to the URL in `API_URL`.

```bash
docker build -t pantry-tracker-web .
docker run -p 4200:80 -e API_URL=http://host.docker.internal:8080 pantry-tracker-web
```

To run the API, database and this app together, use the compose file in pantry-tracker-api
(`docker compose --profile full up --build`, with both repos cloned side by side).

## Deploying to AWS

1. `npx ng build` and upload `dist/frontend/browser` to an S3 bucket.
2. Serve it with CloudFront. Send unknown paths to `/index.html` so client-side routes like
   `/sign-in` work.
3. Add a second CloudFront behavior for `/api/*` that forwards to the API's load balancer, with
   caching disabled and all cookies, headers and query strings passed through. This keeps the app
   and API on one origin, so no CORS setup is needed.

## How it talks to the API

- `core/api.service.ts` holds every call. URLs are relative (`/api/...`), so the browser sends the
  session cookie and Angular's `HttpClient` adds the `X-XSRF-TOKEN` header to POST and DELETE.
- `core/session.service.ts` loads the signed-in person and their logs; the route guards in
  `core/guards.ts` send people to sign-in or to start/join a log as needed.
- `log/log.store.ts` holds the open log's state and listens on `/api/households/{id}/events`
  (Server-Sent Events) so the page refreshes when anyone else logs something.
