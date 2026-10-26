# pantry-tracker-web

[![CI](https://github.com/Rustem-Stilinski/pantry-tracker-web/actions/workflows/ci.yml/badge.svg)](https://github.com/Rustem-Stilinski/pantry-tracker-web/actions/workflows/ci.yml)

Web app for **Pantry Tracker**: a shared log of things that get used up (paper towels, coffee pods,
printer paper) and of what they cost. **Used items** logs what runs out; **Prices** reads receipt
photos and shows price history, price changes, the cheapest store for each item, and monthly spending.
Several people share one log by joining it with an invite code.

The REST API lives in [pantry-tracker-api](https://github.com/Rustem-Stilinski/pantry-tracker-api).

**Stack:** Angular 22 (standalone components, signals, zoneless), plain CSS, Vitest.

```
src/app/
├── core/     API client, session, route guards, formatting helpers
├── log/      Used items: log form, quick repeats, totals, entries by day
├── prices/   Prices: add a receipt (photo → check → save), items and price changes, item history chart,
│             compare stores, receipts by month, spending by month
├── pages/    sign-in and start/join a log
└── shared/   site header, tally-mark component
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

CI (`.github/workflows/ci.yml`) runs the tests, the production build and a Docker image build on
every push and pull request. Each run keeps the built app as a `web-dist` artifact for 7 days.

## Docker

The image serves the built app with nginx and forwards `/api` to the URL in `API_URL`.

```bash
docker build -t pantry-tracker-web .
docker run -p 4200:80 -e API_URL=http://host.docker.internal:8080 pantry-tracker-web
```

To run the API, database and this app together, use the compose file in pantry-tracker-api
(`docker compose --profile full up --build`, with both repos cloned side by side).

## Deploying to Render (current)

Live at https://pantry-tracker-web.onrender.com as a Docker web service, with
`API_URL=https://pantry-tracker-api-mys0.onrender.com` so nginx forwards `/api` to the API.

CI's last job calls the service's deploy hook after the tests, build and Docker image all pass on
`main`. The hook URL is the `RENDER_DEPLOY_HOOK_URL` repository secret (Render service > Settings >
Deploy Hook). Without the secret the job just skips with a warning.

## Deploying to AWS

1. `npx ng build` and upload `dist/frontend/browser` to an S3 bucket.
2. Serve it with CloudFront. Send unknown paths to `/index.html` so client-side routes like
   `/sign-in` work.
3. Add a second CloudFront behavior for `/api/*` that forwards to the API's load balancer, with
   caching disabled and all cookies, headers and query strings passed through. This keeps the app
   and API on one origin, so no CORS setup is needed.

## Adding a receipt

1. Take or choose up to 4 photos (top to bottom for a long receipt). The browser shrinks each to at
   most 2400 px on the long edge before upload (`core/photo.ts`).
2. The API reads them with Claude and returns a draft. Nothing is saved yet.
3. Check the draft: every line's name, quantity, unit, price and category is editable. Changing
   quantity or price recalculates the line total, and a note appears if the lines don't add up to the
   receipt total.
4. Save. The receipt page then lists any item whose price moved 10% or more since you last bought it.

Without an API key on the server, step 2 says so and **Enter it by hand** opens the same form empty.

## How it talks to the API

- `core/api.service.ts` holds every call. URLs are relative (`/api/...`), so the browser sends the
  session cookie and Angular's `HttpClient` adds the `X-XSRF-TOKEN` header to POST and DELETE.
- `core/session.service.ts` loads the signed-in person and their logs; the route guards in
  `core/guards.ts` send people to sign-in or to start/join a log as needed.
- `log/log.store.ts` holds the open log's state and listens on `/api/households/{id}/events`
  (Server-Sent Events) so the page refreshes when anyone else logs something.
