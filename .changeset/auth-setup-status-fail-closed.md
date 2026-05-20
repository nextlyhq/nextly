---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"nextly": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/ui": patch
---

Fix two related admin-auth failures that surface on hosted databases (Neon, Supabase, PlanetScale, etc.) during transient DB hiccups.

**Login/setup fluctuation.** The `getUserCount` dependency in the auth handler bridge used to swallow any DB error and return `0`, which made `GET /auth/setup-status` reply `{ isSetup: false }` whenever a pool cold-start, brief disconnect, or failover landed on this endpoint — the admin route guards then redirected the user to `/admin/setup`, the next call returned `{ isSetup: true }` once the DB recovered, and the guards redirected back to `/admin/login`, oscillating until the next hiccup or full page reload. The user count is the bootstrap-gate for two security-relevant decisions (setup-status reporting and the first-admin pre-check), and treating an unknown count as zero also opened a window where a transient DB failure during `POST /auth/setup` could allow a second super-admin to be created while the real first user was briefly invisible to the query. `getUserCount` now propagates errors; `handleSetupStatus` and `handleSetup` catch them, emit a canonical `503 SERVICE_UNAVAILABLE` envelope through the shared `buildAuthErrorResponse` helper (`application/problem+json` + `x-request-id`), and log a structured operator event (`setup-status-failed` / `setup-precheck-failed`). The admin's `PrivateRoute` and `PublicRoute` now consume a shared `lib/auth/setup-status.ts` module that fail-safes to "setup complete" on any failure (network error, 5xx, invalid response shape) — staying on the dashboard or login screen is recoverable on the next request, whereas dragging an authenticated user into the setup wizard is destructive. `useCurrentUserPermissions` is gated by `routeType === "private"` so its `refetchOnWindowFocus` cannot fire `/me/permissions` during a brief Suspense window on a public route.

**Intermittent logout around the access-token TTL boundary.** The same swallow-and-return-null pattern lived in `findUserById`, which the refresh handler called after deleting the old refresh token. A momentary DB hiccup at the 15-minute boundary returned `null` from the lookup, the handler interpreted that as "user is gone" and ran `clearAndDeny` — clearing both auth cookies and revoking the still-valid session. `findUserById` now propagates errors; `handleRefresh` was reordered so all read-only lookups (`findUserById`, `fetchRoleIds`, `fetchCustomFields`) run BEFORE the destructive `deleteRefreshToken`, and is wrapped in a try/catch that returns `503 SERVICE_UNAVAILABLE` on any DB failure with cookies and tokens intact — the client retries on the next request and the session survives. The admin's `refreshAccessToken` was a boolean primitive that treated every non-200 response (5xx, network errors, our new 503) as "session invalid" and redirected to login; it now returns a tri-state (`ok` / `auth_failed` / `transient`) so `authFetch` only redirects on a genuine 401 from `/auth/refresh` and surfaces transient server errors to the caller without logging the user out.

**Admin-created users could not sign in.** The admin "Create user" page's submit handler never forwarded the `active` checkbox value to the API, so the backend always saw `isActive` as `undefined` and fell back to its default of `false`. `verify-credentials.ts` rejects inactive accounts at every login leg, so the newly-created user could authenticate with the right password and still see a generic "invalid credentials" error. The form now passes `isActive: values.active ?? true` (matching the checkbox's documented "Default: Yes" UX). The backend default stays `false` on purpose — it is load-bearing for self-registration via `/auth/register`, where email verification (`auth-service.verifyEmail`) is what flips `isActive` to `true` and gates login on proof of email ownership.

Internal: consolidated four identical `build{Login,Register,Forgot,Setup}ErrorResponse` helpers into a single `buildAuthErrorResponse` in `handler-utils.ts`, fixed a long-standing `change-password` test mock missing `auditLog`/`trustProxy`/`trustedProxyIps`, brought the `user-mutation-service.transaction.integration.test.ts` DDL back in sync with the live schema (`failed_login_attempts`, `locked_until`), and added regression tests covering the 503 path on both setup endpoints, the refresh-handler 503 path (asserting no cookie clearing and no token deletion), the "no super-admin is created when the pre-check throws" security invariant, and the load-bearing `createLocalUser` default-false `isActive` invariant (so any future re-flip is caught by a failing test).
