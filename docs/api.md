# Wedding App — API Reference

A NestJS backend that manages wedding guests, admin accounts, and a shared photo album backed by the Google Photos Library API.

- **Base URL:** `http://localhost:3000` (configurable via `PORT`)
- **Interactive docs (Swagger):** `http://localhost:3000/docs`
- **Content-Type:** `application/json` for all JSON endpoints; `multipart/form-data` for file uploads
- **Rate limit:** 120 requests / 60 s per IP (configurable via `THROTTLE_TTL` / `THROTTLE_LIMIT`)

---

## Authentication

The API uses **JWT Bearer tokens**. Every request (except endpoints marked *public*) must include:

```
Authorization: Bearer <accessToken>
```

Tokens are obtained via `POST /auth/login` (admins) or `POST /auth/guest` (guests).

### Roles

| Role | String value | Description |
|---|---|---|
| `SUPER_ADMIN` | `super_admin` | Full access; can manage other admins |
| `ADMIN` | `admin` | Can manage guests, admit attendees, and moderate photos |
| `GUEST` | `guest` | Can upload photos and view the album; authenticated by QR token |

### JWT payload

```json
{
  "sub": "<userId>",
  "email": "<email or null>",
  "role": "admin | super_admin | guest",
  "jti": "<uuid — guests only, for one-device enforcement>"
}
```

---

## Error format

All errors follow a consistent envelope:

```json
{
  "statusCode": 401,
  "message": "Invalid credentials.",
  "error": "Unauthorized"
}
```

---

## Auth endpoints — `/auth`

### `POST /auth/login` — Admin login

*Public — no token required.*

Validates an admin's email + password and returns a JWT.

**Request body**

```json
{
  "email": "admin@wedding.app",
  "password": "ChangeMe123!"
}
```

| Field | Type | Rules |
|---|---|---|
| `email` | string | valid email |
| `password` | string | min 6 characters |

**Response `200`**

```json
{
  "accessToken": "<JWT>",
  "user": {
    "id": "uuid",
    "email": "admin@wedding.app",
    "name": "Jane Planner",
    "role": "admin",
    "buttonEnabled": false
  }
}
```

**Errors**

| Status | Reason |
|---|---|
| `401` | Email not found, account inactive, or wrong password |

---

### `POST /auth/guest` — Guest QR login

*Public — no token required.*

Exchanges the unique token embedded in a guest's QR code for a JWT. Calling this again invalidates any previous session for that guest (one active device per guest).

**Request body**

```json
{
  "token": "<64-char hex guest token>"
}
```

| Field | Type | Rules |
|---|---|---|
| `token` | string | non-empty string |

**Response `200`**

```json
{
  "accessToken": "<JWT>",
  "user": {
    "id": "uuid",
    "email": null,
    "name": "Alice Smith",
    "role": "guest",
    "buttonEnabled": true
  }
}
```

**Errors**

| Status | Reason |
|---|---|
| `401` | Token not found or guest is inactive |

---

### `GET /auth/me` — Current user

*Requires: any valid JWT*

Returns the authenticated user's profile decoded from the token.

**Headers**

```
Authorization: Bearer <token>
```

**Response `200`**

```json
{
  "sub": "uuid",
  "email": "admin@wedding.app",
  "role": "admin",
  "name": "Jane Planner",
  "buttonEnabled": false,
  "jti": null
}
```

---

### `POST /auth/admins` — Create admin account

*Requires: `SUPER_ADMIN`*

Creates a new admin (or super_admin) account.

**Headers**

```
Authorization: Bearer <super_admin_token>
```

**Request body**

```json
{
  "email": "planner@wedding.app",
  "password": "StrongPass123!",
  "name": "Jane Planner",
  "role": "admin"
}
```

| Field | Type | Rules |
|---|---|---|
| `email` | string | valid email, required |
| `password` | string | min 8 chars, required |
| `name` | string | optional |
| `role` | `"admin" \| "super_admin"` | optional, defaults to `"admin"` |

**Response `201`**

```json
{
  "id": "uuid",
  "email": "planner@wedding.app",
  "name": "Jane Planner",
  "role": "admin"
}
```

**Errors**

| Status | Reason |
|---|---|
| `403` | Caller is not `super_admin` |
| `409` | Email already in use |

---

### `GET /auth/admins` — List admin accounts

*Requires: `SUPER_ADMIN`*

Returns all non-guest user accounts.

**Headers**

```
Authorization: Bearer <super_admin_token>
```

**Response `200`**

```json
[
  {
    "id": "uuid",
    "email": "admin@wedding.app",
    "name": "Super Admin",
    "role": "super_admin",
    "isActive": true,
    "createdAt": "2025-01-01T00:00:00.000Z"
  }
]
```

---

### `POST /auth/guest-info` — Look up guest by QR token

*Requires: `ADMIN` or `SUPER_ADMIN`*

Returns a guest's profile from their QR token without starting a session. Intended for entrance validation / QR scanner flows.

**Headers**

```
Authorization: Bearer <admin_token>
```

**Request body**

```json
{
  "token": "<64-char hex guest token>"
}
```

**Response `200`**

```json
{
  "id": "uuid",
  "name": "Alice Smith",
  "role": "guest",
  "admissionStatus": "pending",
  "admittedAt": null,
  "avatarUrl": "/users/uuid/avatar"
}
```

**Errors**

| Status | Reason |
|---|---|
| `403` | Caller lacks admin role |
| `404` | Token not found or invalid |

---

## Users endpoints — `/users`

> **Default guard:** all `/users` routes require at minimum `ADMIN` role (JWT + RolesGuard), unless noted otherwise.

---

### `POST /users/admins` — Create admin

*Requires: `SUPER_ADMIN`*

**Headers**

```
Authorization: Bearer <super_admin_token>
```

**Request body**

```json
{
  "name": "Event Planner",
  "email": "planner@wedding.app",
  "password": "StrongPass123!"
}
```

| Field | Type | Rules |
|---|---|---|
| `name` | string | required, max 80 chars |
| `email` | string | valid email, required |
| `password` | string | min 8 chars, required |

**Response `201`** — full user DTO (see shape below)

---

### `DELETE /users/admins/:id` — Delete admin

*Requires: `SUPER_ADMIN`*

**Parameters**

| Name | Type | Description |
|---|---|---|
| `id` | UUID | ID of the admin to delete |

**Response `200`**

```json
{ "deleted": true }
```

**Errors**

| Status | Reason |
|---|---|
| `404` | User not found |
| `409` | Target account is not a regular admin |

---

### `POST /users/guests` — Create guest

*Requires: `ADMIN` or `SUPER_ADMIN`*

Creates a guest record with a random 64-char hex token (the QR code payload).

**Request body**

```json
{
  "name": "Alice Smith"
}
```

| Field | Type | Rules |
|---|---|---|
| `name` | string | required, max 80 chars |

**Response `201`** — full user DTO including `guestToken`

---

### `GET /users` — List all users

*Requires: `ADMIN` or `SUPER_ADMIN`*

**Response `200`** — array of user DTOs

---

### `GET /users/:id` — Get user by ID

*Requires: `ADMIN` or `SUPER_ADMIN`*

**Parameters**

| Name | Type |
|---|---|
| `id` | UUID |

**Response `200`** — user DTO

**Errors:** `404` if not found

---

### `PATCH /users/guests/:id/button` — Toggle action button

*Requires: `ADMIN` or `SUPER_ADMIN`*

Enables or disables the second action button shown on a guest's welcome page.

**Parameters**

| Name | Type |
|---|---|
| `id` | UUID (guest user) |

**Request body**

```json
{ "enabled": true }
```

**Response `200`**

```json
{ "id": "uuid", "buttonEnabled": true }
```

---

### `DELETE /users/guests/:id` — Delete guest

*Requires: `ADMIN` or `SUPER_ADMIN`*

Permanently deletes a guest account.

**Parameters**

| Name | Type |
|---|---|
| `id` | UUID |

**Response `200`**

```json
{ "deleted": true }
```

**Errors**

| Status | Reason |
|---|---|
| `404` | User not found |
| `409` | Target account is not a guest |

---

### `POST /users/me/avatar` — Upload own avatar

*Requires: any authenticated user (guest, admin, or super_admin)*

Uploads and stores the caller's profile picture.

**Headers**

```
Authorization: Bearer <token>
Content-Type: multipart/form-data
```

**Form fields**

| Field | Type | Rules |
|---|---|---|
| `file` | binary | required; JPEG, PNG, WebP, or GIF; max 8 MB |

**Response `200`**

```json
{ "avatarUrl": "/users/uuid/avatar" }
```

**Errors**

| Status | Reason |
|---|---|
| `400` | No file sent |
| `403` | Unsupported MIME type |

---

### `PATCH /users/:id/avatar` — Admin sets user avatar

*Requires: `ADMIN` or `SUPER_ADMIN`*

Same behaviour as `POST /users/me/avatar` but targets any user by ID.

**Parameters**

| Name | Type |
|---|---|
| `id` | UUID |

**Form fields** — same as above

**Response `200`**

```json
{ "avatarUrl": "/users/uuid/avatar" }
```

---

### `GET /users/:id/avatar` — Serve avatar image

*Public — no token required.*

Returns the user's avatar image directly. Safe to use in `<img>` `src` attributes.

**Parameters**

| Name | Type |
|---|---|
| `id` | UUID |

**Response `200`** — raw image bytes with the correct `Content-Type` header (`image/jpeg`, `image/png`, etc.)

Cache-Control: `private, max-age=300`

**Errors:** `404` if the user has no avatar

---

### `POST /users/:id/admit` — Admit guest at entrance

*Requires: `ADMIN` or `SUPER_ADMIN`*

Marks a guest as admitted. Sets `admissionStatus` to `"admitted"` and stamps `admittedAt`. Idempotent — calling it again on an already-admitted guest is a no-op.

**Parameters**

| Name | Type |
|---|---|
| `id` | UUID |

**Response `200`**

```json
{
  "id": "uuid",
  "admissionStatus": "admitted",
  "admittedAt": "2025-06-15T14:00:00.000Z"
}
```

---

### User DTO shape

All user endpoints that return a user object use this shape:

```json
{
  "id": "uuid",
  "name": "Alice Smith",
  "email": null,
  "role": "guest",
  "isActive": true,
  "guestToken": "4a3b...",
  "buttonEnabled": false,
  "admissionStatus": "pending",
  "admittedAt": null,
  "avatarUrl": "/users/uuid/avatar",
  "createdAt": "2025-01-01T00:00:00.000Z"
}
```

> `email` and `guestToken` are `null` for the other type — admins have email but no token; guests have a token but no email.

---

## Photos endpoints — `/photos`

All photo endpoints require a valid JWT (any role), except `GET /photos/:id/raw` which is public.

---

### `GET /photos` — List photos (paginated)

*Requires: any authenticated user*

Returns a paginated list of photos from the wedding Google Photos album.

**Query parameters**

| Param | Type | Default | Description |
|---|---|---|---|
| `page` | integer ≥ 1 | `1` | Page number |
| `pageSize` | integer 1–100 | `25` | Items per page |
| `refresh` | boolean | `false` | Bypass cache: re-sync album index and refresh base URLs |

**Response `200`**

```json
{
  "data": [
    {
      "id": "google-media-item-id",
      "filename": "IMG_0001.jpg",
      "mimeType": "image/jpeg",
      "description": "The first dance",
      "creationTime": "2025-06-15T20:00:00Z",
      "width": 4032,
      "height": 3024,
      "baseUrl": "https://lh3.googleusercontent.com/...",
      "thumbnailUrl": "https://lh3.googleusercontent.com/...=w400-h400",
      "displayUrl": "https://lh3.googleusercontent.com/...=w1600",
      "downloadUrl": "https://lh3.googleusercontent.com/...=d",
      "rawUrl": "/photos/google-media-item-id/raw?size=display",
      "uploaderId": "user-uuid",
      "uploaderName": "Alice Smith",
      "uploadedAt": "2025-06-15T20:05:00.000Z"
    }
  ],
  "meta": {
    "page": 1,
    "pageSize": 25,
    "total": 200,
    "totalPages": 8,
    "hasNextPage": true,
    "hasPreviousPage": false
  }
}
```

> `baseUrl`, `thumbnailUrl`, `displayUrl`, and `downloadUrl` are **direct Google URLs that expire after ~60 minutes**. Use `rawUrl` (or the `/raw` endpoint) for stable links in a UI.

---

### `GET /photos/:id` — Get single photo

*Requires: any authenticated user*

Fetches one photo with a fresh Google base URL.

**Parameters**

| Name | Type |
|---|---|
| `id` | Google Media Item ID (string) |

**Query parameters**

| Param | Type | Default | Description |
|---|---|---|---|
| `refresh` | boolean | `false` | Force a fresh URL fetch from Google |

**Response `200`** — single photo DTO (same shape as items in the list response)

**Errors:** `404` if not found in the album

---

### `GET /photos/:id/raw` — Redirect to sized image/video

*Public — no token required.*

Resolves a fresh Google URL for the requested size and redirects to it (`302`). This is the stable link to use in `<img src>` or `<video src>`.

The response is cached by the browser for 5 minutes (`Cache-Control: private, max-age=300`).

**Parameters**

| Name | Type |
|---|---|
| `id` | Google Media Item ID |

**Query parameters**

| Param | Type | Default | Description |
|---|---|---|---|
| `size` | string | `display` | `thumb` (400×400), `display` (w1600 / video stream), `download` (original / video stream), or a raw Google param like `w800-h600` |

**Response** — `302` redirect to the Google-hosted URL

**Errors:** `404` if the item is not in the album

---

### `POST /photos/upload` — Upload a single photo/video

*Requires: any authenticated user*

Uploads one image or video to the wedding album.

**Headers**

```
Authorization: Bearer <token>
Content-Type: multipart/form-data
```

**Form fields**

| Field | Type | Rules |
|---|---|---|
| `file` | binary | required; any `image/*` or `video/*` MIME; max 200 MB |
| `description` | string | optional; max 1000 chars |

**Response `201`** — photo DTO of the newly created item

**Errors**

| Status | Reason |
|---|---|
| `400` | No file, unsupported MIME type, or Google rejected the upload |
| `502` | Google Photos API error |

---

### `POST /photos/upload/bulk` — Bulk upload photos/videos

*Requires: any authenticated user*

Uploads up to 200 files in a single request. Files are uploaded concurrently (5 at a time), then registered with Google Photos in one batch. Partial success is supported — the response reports both created and failed items.

**Headers**

```
Authorization: Bearer <token>
Content-Type: multipart/form-data
```

**Form fields**

| Field | Type | Rules |
|---|---|---|
| `files` | binary[] | required; up to 200 files; same MIME and size rules as single upload |
| `description` | string | optional; max 1000 chars; applied to all files |

**Response `201`**

```json
{
  "createdCount": 5,
  "failedCount": 1,
  "created": [ /* array of photo DTOs */ ],
  "failed": [
    { "filename": "bad-file.bmp", "reason": "Google Photos rejected the upload." }
  ]
}
```

---

### `POST /photos/refresh` — Force album re-sync

*Requires: `ADMIN` or `SUPER_ADMIN`*

Drops the cached album index and re-fetches the full list of media items from Google Photos.

**Response `200`**

```json
{ "total": 312 }
```

---

## Google OAuth setup endpoints — `/google`

These endpoints are **for one-time setup only**. They are excluded from the Swagger docs and should be disabled (or put behind a network allow-list) once `GOOGLE_REFRESH_TOKEN` is configured in production.

Both are **public** (no JWT required) because the Google OAuth redirect arrives without a token.

---

### `GET /google/auth-url` — Generate OAuth consent URL

Returns the Google OAuth 2.0 URL that the wedding Google account owner must open to grant the app access to Google Photos.

**Response `200`**

```json
{
  "message": "Open this URL in a browser, sign in as the WEDDING Google account, and approve access.",
  "url": "https://accounts.google.com/o/oauth2/v2/auth?..."
}
```

---

### `GET /google/callback` — OAuth code exchange

Google redirects here after the user approves consent. The server exchanges the `code` for tokens and returns the refresh token.

**Query parameters**

| Param | Description |
|---|---|
| `code` | Authorization code from Google |
| `error` | Set by Google if the user denied consent |

**Response `200` (success)**

```json
{
  "message": "Success! Copy the refreshToken below into GOOGLE_REFRESH_TOKEN in your .env, then restart the server.",
  "refreshToken": "1//0g..."
}
```

**Response `200` (no refresh token returned — needs re-consent)**

```json
{
  "warning": "No refresh_token returned. Revoke the app at myaccount.google.com/permissions and retry ...",
  "accessToken": "ya29..."
}
```

> A refresh token is only issued on the **first** consent for a given client. If you lost yours, revoke the app at [myaccount.google.com/permissions](https://myaccount.google.com/permissions) and run the flow again. Alternatively, use `npm run get:token` for a fully offline setup.

---

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP listen port |
| `NODE_ENV` | `development` | Node environment |
| `CORS_ORIGINS` | `*` | Comma-separated allowed origins |
| `JWT_SECRET` | `insecure-dev-secret` | **Change in production** |
| `JWT_EXPIRES_IN` | `7d` | Token lifetime |
| `SEED_ADMIN_EMAIL` | `admin@wedding.app` | Email of the auto-seeded super-admin |
| `SEED_ADMIN_PASSWORD` | `ChangeMe123!` | Password of the auto-seeded super-admin |
| `DB_TYPE` | `sqlite` | `sqlite` or `postgres` |
| `DB_DATABASE` | `./data/wedding.sqlite` | SQLite file path (or Postgres DB name) |
| `DB_HOST` | `localhost` | Postgres host |
| `DB_PORT` | `5432` | Postgres port |
| `DB_USERNAME` | `postgres` | Postgres user |
| `DB_PASSWORD` | `postgres` | Postgres password |
| `GOOGLE_CLIENT_ID` | — | OAuth 2.0 client ID |
| `GOOGLE_CLIENT_SECRET` | — | OAuth 2.0 client secret |
| `GOOGLE_REDIRECT_URI` | `http://localhost:3000/google/callback` | OAuth redirect URI |
| `GOOGLE_REFRESH_TOKEN` | — | Long-lived token for the wedding Google account |
| `GOOGLE_PHOTOS_ALBUM_ID` | — | Pre-created album ID (auto-created if blank) |
| `GOOGLE_PHOTOS_ALBUM_TITLE` | `Our Wedding` | Album name used when auto-creating |
| `ALBUM_INDEX_TTL` | `300` | Seconds to cache the album's photo index |
| `BASE_URL_TTL` | `3000` | Seconds to cache Google base URLs (must be < 3600) |
| `THROTTLE_TTL` | `60` | Rate-limit window in seconds |
| `THROTTLE_LIMIT` | `120` | Max requests per window per IP |

---

## Caching notes

Google Photos base URLs expire after **60 minutes**. The backend uses a two-layer cache to handle this:

1. **Album index** — the ordered list of photo IDs and metadata. Cached for `ALBUM_INDEX_TTL` seconds and automatically busted after every upload. Never contains expiring URLs.
2. **Fresh item cache** — per-photo `GoogleMediaItem` (including `baseUrl`), cached for `BASE_URL_TTL` seconds. Only fetched for photos actually being served.

For UI implementations, always use `rawUrl` (`/photos/:id/raw`) or render `<img>` tags pointing at that path. The server will redirect to a fresh Google URL transparently, so the link never expires from the client's point of view.

---

## Quick start flow

1. Copy `.env.example` → `.env` and fill in your values.
2. Run `npm run get:token` (or `GET /google/auth-url` → `GET /google/callback`) to obtain `GOOGLE_REFRESH_TOKEN`.
3. Start the server: `npm run start:dev`.
4. On first boot, a super-admin account is seeded from `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`.
5. Log in via `POST /auth/login` to get your JWT.
6. Create guest records via `POST /users/guests` — each gets a unique QR token.
7. Guests scan their QR code, which calls `POST /auth/guest` to get a JWT, and can then upload and view photos.
