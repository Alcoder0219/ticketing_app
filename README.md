# Aum Dacro Ticketing

A multi-plant helpdesk / ticketing app. **Originally built on Supabase, now
running on a self-hosted Express + MongoDB backend.**

- `src/` — the Vite + React + TypeScript frontend.
- `server/` — the Express + MongoDB backend that replaces Supabase
  (database, auth, storage, realtime, edge functions). See [server/README.md](server/README.md).

## Running locally

You need **two** processes: the backend API and the frontend.

### 1. Backend (`server/`)

```bash
cd server
npm install
cp .env.example .env          # edit MONGODB_URI, JWT_SECRET
npm run dev                   # http://localhost:4000
```

Requires a MongoDB instance (local Docker: `docker run -d -p 27017:27017 mongo:7`).

Create a login:

```bash
ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='StrongPass123!' npm run seed:admin
```

### 2. Frontend (repo root)

```bash
npm install
npm run dev                   # Vite dev server
```

The frontend reads `VITE_API_URL` (and `VITE_SUPABASE_URL`, kept pointing at the
same backend for legacy `/functions/v1` calls) from `.env`.

## Migrating data from the old Supabase project

In `server/.env` set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, then:

```bash
cd server && npm run migrate:from-supabase
```

> Supabase doesn't export password hashes, so migrated users arrive disabled.
> Re-enable each by setting a new password (Manage Users → edit credentials).

## How the Supabase → MongoDB migration works

The frontend code was **not** rewritten call-by-call. Instead,
`src/integrations/supabase/client.ts` now exports a drop-in client
(`src/integrations/api/`) that preserves the Supabase API surface
(`from().select().eq()…`, `auth`, `storage`, `functions.invoke`, `rpc`,
`channel`) but talks to the new backend. The old `supabase/` directory
(migrations + edge functions) is kept for reference.
