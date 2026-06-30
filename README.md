# Wedding Photos Backend (NestJS + Google Photos)

A production-shaped NestJS backend for a wedding photo app. It stores every
photo in **one shared Google Photos album** ("the wedding library"), and exposes
a clean, authenticated, paginated, cache-efficient API to **list** all photos and
**upload** new ones (single or bulk).

---

## ⚠️ Read this first — how Google Photos works in 2025+

Google changed the Photos Library API on **April 1, 2025**. This drives the whole
design, so it's worth understanding:

- The old `photoslibrary.readonly` scope is **gone**. An app can now **only
  list / search / retrieve media items it created itself** (the
  `photoslibrary.readonly.appcreateddata` scope).
- **Consequence:** the only way to "fetch all photos in a library" is for *this
  backend* to be the thing that uploads them. Photos that someone adds **directly
  in the Google Photos app are invisible to the API.** Everything must flow
  through the upload endpoints here. (If you ever need users to pick from their
  *own* full libraries, that's a different product — the Google Photos **Picker
  API**.)
- **Service accounts are not supported.** "Credentials on the backend" therefore
  means: one OAuth2 client + a long-lived **refresh token** for the wedding
  Google account, stored in `.env`. The backend acts as that one account.
- **`baseUrl`s expire after 60 minutes.** Google's guidance is to store media
  **IDs**, not URLs, and re-fetch fresh URLs on demand. This app does exactly
  that with a two-layer cache (see below).

---

## Architecture

```
            ┌──────────────┐   JWT     ┌─────────────────────────────┐
  Frontend ─┤  Your admins │──────────▶│  NestJS API                 │
            └──────────────┘           │                             │
                                       │  Auth (JWT) ── Users (DB)   │
   <img src="/photos/:id/raw"> ───────▶│  Photos ── PhotoCache       │
                                       │             │               │
                                       └─────────────┼───────────────┘
                                                     │ OAuth2 refresh token
                                                     ▼
                                       ┌─────────────────────────────┐
                                       │  Google Photos Library API  │
                                       │  (one app-created album)    │
                                       └─────────────────────────────┘
```

**Two-layer cache (`PhotoCacheService`)** keeps things fast *and* correct:

1. **Album index** — the ordered list of `{id + metadata}` for the album. IDs are
   permanent, so this is cached for `ALBUM_INDEX_TTL` and busted on every upload.
2. **Fresh items** — per-id media item incl. a fresh `baseUrl`, cached for
   `BASE_URL_TTL` (must be `< 3600s`). Only the items on the page you're serving
   are fetched, via `mediaItems:batchGet` (≤ 50/call), and only when stale.

**Stable image URLs.** Each photo's `rawUrl` (`GET /photos/:id/raw`) is served by
*this* API and never expires — it 302-redirects to a freshly-resolved Google URL.
Point your `<img src>` at it and you never hit an expired link.

---

## Tech stack

NestJS 10 · TypeORM (SQLite default, Postgres optional) · Passport-JWT · bcrypt ·
`@nestjs/cache-manager` · `@nestjs/throttler` · `google-auth-library` · Swagger.

---

## Setup

### 1. Google Cloud project
1. Create a project at <https://console.cloud.google.com>.
2. **Enable the "Photos Library API"** (APIs & Services → Library).
3. Configure the OAuth consent screen (External is fine; add the wedding Google
   account as a **Test user** while in testing).
4. Create an **OAuth client ID → Web application**. Add an authorized redirect
   URI of `http://localhost:3000/google/callback` (match `GOOGLE_REDIRECT_URI`).
5. Copy the **Client ID** and **Client secret**.

### 2. Install & configure
```bash
cp .env.example .env
#   → set JWT_SECRET, SEED_ADMIN_*, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
npm install     # needs build tools for better-sqlite3 (python3, make, g++)
```

### 3. Get the Google refresh token (one time)
```bash
npm run get:token
#   → open the printed URL, sign in as the WEDDING Google account, approve
#   → copy the printed token into GOOGLE_REFRESH_TOKEN in .env
```

### 4. Run
```bash
npm run start:dev
#   → API:     http://localhost:3000
#   → Swagger: http://localhost:3000/docs
```
On first photo activity the app **creates the wedding album** and logs its ID.
Paste that into `GOOGLE_PHOTOS_ALBUM_ID` in `.env` so it's reused on restart.

---

## Authentication

A **super-admin** is seeded from `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` on
first boot. Log in to get a JWT, then send it as `Authorization: Bearer <token>`.

```bash
curl -X POST localhost:3000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@wedding.app","password":"ChangeMe123!"}'
```

Every route requires a JWT **except**: `POST /auth/login`, the `/google/*` setup
routes, and `GET /photos/:id/raw` (so `<img>` tags render without a token).

---

## API reference

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/auth/login` | public | Get a JWT. |
| GET  | `/auth/me` | admin | Current admin from the token. |
| POST | `/auth/admins` | super-admin | Create another admin. |
| GET  | `/auth/admins` | super-admin | List admins. |
| GET  | `/photos` | admin | **List all photos, paginated.** Query: `page`, `pageSize` (≤100), `refresh`. |
| GET  | `/photos/:id` | admin | One photo with a fresh URL. `?refresh=true` to bypass cache. |
| GET  | `/photos/:id/raw` | public | **302-redirect to a fresh image.** `?size=thumb\|display\|download\|w800-h600`. |
| POST | `/photos/upload` | admin | **Single upload** (multipart field `file`, optional `description`). |
| POST | `/photos/upload/bulk` | admin | **Bulk upload** (multipart field `files`, up to 200). |
| POST | `/photos/refresh` | admin | Force a full album re-sync + drop cached URLs. |
| GET  | `/google/auth-url` | public* | Setup: get the consent URL. |
| GET  | `/google/callback` | public* | Setup: exchange the OAuth code for a refresh token. |

\* Disable the `/google/*` routes (or network-restrict them) once set up.

### List response shape
```json
{
  "data": [
    {
      "id": "AKx...",
      "filename": "IMG_2043.jpg",
      "mimeType": "image/jpeg",
      "description": "First dance",
      "creationTime": "2025-06-14T19:32:11Z",
      "width": 4032,
      "height": 3024,
      "baseUrl": "https://lh3.googleusercontent.com/...",
      "thumbnailUrl": "https://lh3.googleusercontent.com/...=w400-h400",
      "displayUrl":  "https://lh3.googleusercontent.com/...=w1600",
      "downloadUrl": "https://lh3.googleusercontent.com/...=d",
      "rawUrl": "/photos/AKx.../raw?size=display"
    }
  ],
  "meta": { "page": 1, "pageSize": 25, "total": 482, "totalPages": 20,
            "hasNextPage": true, "hasPreviousPage": false }
}
```
> `baseUrl`/`thumbnailUrl`/`displayUrl`/`downloadUrl` expire in ~60 min.
> Use **`rawUrl`** for anything long-lived in the browser.

### Examples
```bash
TOKEN=...   # from /auth/login

# List page 2, 50 per page
curl "localhost:3000/photos?page=2&pageSize=50" -H "Authorization: Bearer $TOKEN"

# Single upload
curl -X POST localhost:3000/photos/upload -H "Authorization: Bearer $TOKEN" \
  -F file=@./photo.jpg -F description="Cutting the cake"

# Bulk upload
curl -X POST localhost:3000/photos/upload/bulk -H "Authorization: Bearer $TOKEN" \
  -F files=@./a.jpg -F files=@./b.jpg -F files=@./c.jpg
```

---

## Configuration notes

- **Database**: SQLite by default (`./data/wedding.sqlite`). For Postgres set
  `DB_TYPE=postgres` and the `DB_*` vars, or use `docker compose up`.
- **Cache**: in-memory by default — fine for a single instance. For multiple
  instances, plug a Redis store into `CacheModule` in `app.module.ts`.
- **Rate limiting**: `THROTTLE_LIMIT` requests per `THROTTLE_TTL` seconds.
- **Upload limits**: 200 MB/file, 200 files/bulk request — tune in
  `photos.controller.ts`.
- `synchronize: true` is on for convenience; switch to TypeORM migrations before
  a real production deployment.

## Limitations to be aware of

- Only photos uploaded **through this API** are visible — by Google's design.
- A `batchCreate` returns **207 Multi-Status** on partial success; the bulk
  endpoint reports per-file `failed[]` accordingly.
- `mediaItems:search` max page size is 100; this API caps `pageSize` at 100.
- Albums hold up to 20,000 items.

---

## Guest user system

### Overview

Admins can create **guest accounts** — name-only users who receive a unique QR
code. Scanning the QR auto-authenticates the guest (no password, no form) and
gives them full upload access. A **one-device policy** is enforced: re-scanning
the QR on any device invalidates every previous session for that guest.

### New roles

| Role | Description |
|---|---|
| `admin` | Can create/delete guests and list users. |
| `super_admin` | Admin + can create other admins. |
| `guest` | Upload-only; authenticated via QR token, no email/password. |

### User entity changes

`email` and `passwordHash` are now nullable (guests have neither). Two new
columns were added:

| Column | Type | Purpose |
|---|---|---|
| `guestToken` | `varchar` (unique, nullable) | 64-char hex secret embedded in the QR URL. |
| `currentJti` | `varchar` (nullable) | UUID of the guest's **current** active JWT. Updated on every QR scan. |

> If you have an existing `wedding.sqlite` from before this change, delete it
> and let `synchronize: true` recreate the schema on next boot.

### New endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/auth/guest` | public | Exchange a `guestToken` for a JWT. Rotates `currentJti` (invalidates previous session). |
| POST | `/users/guests` | admin | Create a guest — body: `{ "name": "Uncle James" }`. Returns the new user incl. `guestToken`. |
| GET  | `/users` | admin | List all users (admins + guests). |
| DELETE | `/users/guests/:id` | admin | Delete a guest account and invalidate their QR. |

### One-device enforcement

Every `POST /auth/guest` call:
1. Looks up the user by `guestToken`.
2. Generates a new `jti` (UUID) and writes it to `currentJti` in the DB.
3. Issues a JWT with `jti` in the payload.

The JWT strategy checks `payload.jti === user.currentJti` for every guest
request. A re-scan on a second device writes a new `currentJti`, immediately
rejecting all tokens that carry the old `jti`.

Admin and super-admin JWTs are **exempt** from the `jti` check.

### Guest login flow

```
QR scan → GET /guest?t=<guestToken>   (frontend)
        → POST /auth/guest { token }  (backend)
        → { accessToken, user }
        → redirect to gallery
```

### Bug fix — images not loading until restart

`POST /photos/upload/bulk` calls Google's `batchCreate`, which returns media
items **without a `baseUrl`** while Google's pipeline processes the upload. The
cache previously stored these incomplete items, causing `/photos/:id/raw` to
return 404 until the cache expired and the backend was restarted.

**Fix (in `PhotoCacheService`):**
- `primeFresh` now skips any item that has no `baseUrl`.
- `getFreshByIds` treats a cached item with no `baseUrl` as a cache miss,
  forcing a fresh `batchGet` until Google finishes processing.
