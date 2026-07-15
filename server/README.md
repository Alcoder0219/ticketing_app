# Aum Dacro Ticketing — Backend (Express + MongoDB)

This server replaces **Supabase**. It provides everything the frontend used to
get from Supabase, over plain HTTP + WebSockets:

| Supabase feature | Replacement here |
|---|---|
| Postgres + PostgREST (`supabase.from()`) | `POST /rest/query` — a PostgREST-compatible query engine over MongoDB (filters, embedded joins, ordering, ranges, single/maybeSingle, count, upsert) |
| Auth (`supabase.auth`) | JWT auth — `/auth/login`, `/auth/signup`, `/auth/session`, `/auth/user` |
| Row-Level Security | Ported to server-side authorization (`src/auth/authz.ts`) |
| Storage (`supabase.storage`) | `/storage/v1/object/...` (local-disk driver, signed URLs) |
| Realtime (`supabase.channel`) | socket.io (`src/realtime/io.ts`) |
| Edge Functions (`functions.invoke`) | `/functions/v1/*` (`src/functions/`) |
| Postgres RPC (`supabase.rpc`) | `/rest/rpc/:fn` (`src/rest/rpc.ts`) |

## Quick start

```bash
cd server
npm install
cp .env.example .env          # then edit MONGODB_URI, JWT_SECRET, etc.
npm run dev                   # http://localhost:4000
```

You need a MongoDB instance. Local Docker:

```bash
docker run -d -p 27017:27017 --name adt-mongo mongo:7
```

### Create your first admin

```bash
ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='StrongPass123!' npm run seed:admin
```

### Migrate existing data from the old Supabase project

Put `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `.env`, then:

```bash
npm run migrate:from-supabase
```

Migrated users are created **disabled** (Supabase doesn't export password
hashes). Re-enable each by setting a password via the admin UI
(Manage Users → edit credentials) or `seed:admin`.

## Architecture notes

- **IDs**: every document uses a string UUID `_id`, surfaced to the client as
  `id`. This preserves all the old string foreign keys (`raised_by`,
  `ticket_id`, `user_id`, …) byte-for-byte.
- **Embedded selects**: `select("*, raiser:profiles!tickets_raised_by_fkey(name)")`
  is resolved by `src/models/relationships.ts` + `src/rest/selectParser.ts`.
- **Authorization**: the `tickets` visibility RLS policy is fully ported in
  `ticketsVisibilityFilter()`. Additional per-table policies can be layered in
  `authFilterFor()` in `src/rest/routes.ts`.

## Environment variables

See `.env.example`. Integration features (AI chat, Slack, BigQuery, Google
Sheets) are optional and degrade gracefully when their credentials are absent.
