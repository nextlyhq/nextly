# Nextly Beta CMS — Comprehensive Security Audit

**Repo:** `/home/mobeen/Desktop/sites/Nextly` · **Branch:** `dev` · **Date:** 2026-04-27
**Scope:** `packages/nextly`, `packages/admin`, `packages/client`, adapter-{postgres,mysql,sqlite,drizzle}, storage-{s3,vercel-blob,uploadthing}, plugin-form-builder, create-nextly-app, e2e, docker, CI.

> **Implementing fixes?** Use [SECURITY_FIXES.md](SECURITY_FIXES.md) — that's the execution tracker with stable task IDs (T-001…), parallel swimlanes, verification commands, and PR conventions. This document remains the source of truth for _what's wrong_; the fixes doc is the day-to-day _what we're doing about it_.

---

## Update log

- **R1 (2026-04-27)** — Initial audit (5 parallel domain agents).
- **R2 (2026-04-27)** — Verification round: `pnpm audit`, mass-assignment, signup enumeration, Direct API isolation, default REST exposure, Vercel Blob & UploadThing adapters, body/query limits, encryption-at-rest, Cache-Control, source maps, log injection. **+2 Critical, +4 High, +5 Medium, 1 retraction (M2), 5 new verified positives.**
- **R3 (2026-04-28)** — Focused SQL-injection deep-dive across 9 surfaces (sort, limit, LIKE wildcards, JSON paths, `sql.raw` usage, identifier injection, full-text search, migration generation, service-layer raw queries). **+1 High (H15: LIKE wildcard injection in where-filter), strengthened H9, 6 new verified-safe surfaces.**
- **R4 (2026-04-28)** — Maintainer review pass. **H6 (field-level access control)** moved to a new "Accepted risks / intentional design" section — it is by design, not a vulnerability. **H13 (body size caps)** fix scope clarified: expose the limits as `nextly.config.ts` configuration with secure defaults rather than hard-coded values.

---

## Executive Summary

Nextly's security architecture is **fundamentally sound** — bcrypt (cost 12), brute-force lockout, double-submit CSRF with constant-time compare, 256-bit hashed reset tokens, JWT with hardcoded HS256 (no `alg=none`), proper cookie flags, RBAC with role inheritance, AES-256-GCM at rest with correct cipher mode, and parameterized Drizzle queries throughout. The framework gets the hard parts right.

The audit surfaced **7 Critical** and **14 High** issues that must be fixed before launching to production traffic, plus **1 design decision (former H6)** explicitly accepted by the maintainers. Two patterns dominate the worst findings:

1. **The framework over-trusts client-supplied state** — TLS upgrades, `X-Forwarded-For`, MIME types, redirect paths, S3 ACL defaults, attachment URLs, multipart sizes.
2. **Convenience defaults invert the principle of least privilege** — collections are public-by-default, S3 ACL is `public-read`-by-default, Vercel Blob is public-only, the Direct API ships with `overrideAccess: true` and only a try/catch'd `server-only` import as the boundary, and PostgreSQL silently disables cert validation on cloud providers.

Each is a one-line config or one-helper-function fix individually, but together they widen the attack surface considerably.

| Severity                  | Count         |
| ------------------------- | ------------- |
| Critical                  | 7             |
| High                      | 14            |
| Medium                    | 23            |
| Low                       | 9             |
| Retracted                 | 1 (M2)        |
| Accepted risk / by design | 1 (former H6) |
| Verified positive         | 28            |

---

## CRITICAL — fix before beta launch

### C1. PostgreSQL silently disables certificate validation on cloud providers

**Location:** [packages/adapter-postgres/src/index.ts:774](packages/adapter-postgres/src/index.ts#L774)

When provider auto-detection (Neon/Supabase/etc.) determines SSL is required but the user didn't explicitly configure it, the adapter sets `ssl = { rejectUnauthorized: false }`. This is a **silent MITM downgrade** — DB credentials and all in-transit data can be intercepted by any on-path attacker.

**Fix:** Default to `rejectUnauthorized: true`. Require the user to explicitly opt out (and emit a warning if they do).

---

### C2. S3 storage adapter defaults uploads to `public-read`

**Location:** [packages/storage-s3/src/adapter.ts:116](packages/storage-s3/src/adapter.ts#L116)

`acl: config.acl ?? "public-read"` — every uploaded file (private user docs, internal media, anything) is world-readable by default unless the integrator explicitly overrides. For a CMS, this is the wrong default.

**Fix:** Default to `private`. Require explicit opt-in for public buckets. Document clearly. Pair with signed URLs for read access.

---

### C3. SSRF in email attachment fetch

**Location:** [packages/nextly/src/di/registrations/register-email.ts:68-88](packages/nextly/src/di/registrations/register-email.ts#L68-L88)

`readBytes` does `fetch(storagePath)` if `storagePath.startsWith("http")`. No private-IP blocklist, no metadata-service block (`169.254.169.254`), no allowlist. Any code path that lets a user control an attachment URL can probe internal services or exfiltrate IAM creds.

**Fix:** Restrict attachments to known storage backends; if URL fetch is required, validate against an allowlist and block RFC1918 + link-local + loopback + cloud metadata IPs after DNS resolution (defends against DNS rebinding).

---

### C4. `X-Forwarded-For` trusted blindly across rate-limit, auth, and refresh-token binding

**Locations:**

- [packages/nextly/src/middleware/rate-limit.ts:318-339](packages/nextly/src/middleware/rate-limit.ts#L318-L339)
- [packages/nextly/src/auth/handlers/handler-utils.ts:66-68](packages/nextly/src/auth/handlers/handler-utils.ts#L66-L68)

`getClientIp` returns the first comma-split value from the header with no proxy validation. An attacker connecting directly (no reverse proxy) or through a proxy that doesn't strip the header can rotate `X-Forwarded-For` per request to **bypass per-IP rate limits**, **defeat brute-force lockout**, and **poison logged source IPs**. Also note: when using XFF, the _rightmost_ untrusted value is what your edge added — leftmost is what the client claimed.

**Fix:** Add a `trustProxy` config + `TRUSTED_PROXY_IPS` env var. Only honor `X-Forwarded-For` when the immediate peer is on that list. When honored, take the rightmost-untrusted hop, not the leftmost. Document that direct internet exposure without a trusted proxy means XFF is ignored.

---

### C5. File upload validates only `Content-Type`, not magic bytes or extension

**Location:** [packages/nextly/src/services/upload-service.ts:483-515](packages/nextly/src/services/upload-service.ts#L483-L515)

`BLOCKED_MIME_TYPES` covers only 4 types (`text/html`, `application/xhtml+xml`, `application/javascript`, `text/javascript`). A client-supplied `Content-Type: image/jpeg` lets through `.svg` (SVG-with-`<script>` is a classic stored XSS), `.xml`, `.shtml`, double-extensions, and polyglots. SVG-attachment-disposition is gated behind `svgCsp: true` opt-in rather than being the default.

**Fix:**

1. Add an extension allowlist per upload context (or strict blocklist: `html|htm|svg|svgz|xhtml|xht|shtml|xml|php*|asp*|jsp*|exe|sh|bat|cmd|js|msi`).
2. Sniff actual bytes with `file-type` and reject mismatch.
3. Sanitize SVGs with DOMPurify on upload OR force `Content-Disposition: attachment` regardless of `svgCsp`.
4. Serve user uploads from a cookieless subdomain to neutralize cookie-stealing if XSS slips through.

---

### C6. Collections are PUBLIC for all operations by default ⭐ NEW (R2)

**Location:** [packages/nextly/src/services/access/access-control-service.ts:198-210](packages/nextly/src/services/access/access-control-service.ts#L198-L210)

```typescript
const rule = rules?.[operation];
// No rule = public access (for backward compatibility)
if (!rule) {
  return { allowed: true };
}
```

When a developer registers a collection with no explicit `access` config, **every operation** (create, read, update, delete) is fully public. There is no draft/published filter applied automatically. For a CMS — where the framing is "I can ship `collections: [{ slug: 'posts' }]` and have something that works" — this is the inverse of what users expect. The first developer who forgets to set `access: { read: …, create: … }` ships a fully open API.

**Fix:** Default-deny. Require explicit `access: { read: 'public' }` to opt in. If breaking-change concerns forbid that, at minimum: emit a startup warning for every registered collection without explicit access rules; ship a `nextly audit-access` CLI that flags missing rules in CI; and document loudly in the quickstart that the framework is public-by-default until rules are added.

---

### C7. Direct API ships database-bypass code with weak server-only enforcement ⭐ NEW (R2)

**Locations:**

- [packages/nextly/src/services/lib/permissions.ts:11-15](packages/nextly/src/services/lib/permissions.ts#L11-L15) — the _only_ client-side guard.
- [packages/nextly/src/nextly.ts:252](packages/nextly/src/nextly.ts#L252) — `overrideAccess: true` default.

```typescript
void (async () => {
  try {
    await import("server-only");
  } catch {}
})();
```

The `try/catch` swallows the protection error. `import "server-only"` is a Next.js / bundler convention — it relies on the bundler refusing to include the module in client bundles. If the bundler tree-shakes the side-effect-only import (it can — there's no top-level side effect emitted), or if a developer's webpack/Vite config strips it, the entire Direct API ships to the browser. Combined with the Direct API's `overrideAccess: true` default, a single accidental client-component import bypasses **all** RBAC and exposes the database to the browser.

**Fix:** Replace the try/catch with a top-of-file `import "server-only"` (no async, no catch — let the bundler error). Add a runtime `if (typeof window !== "undefined") throw new Error("Direct API is server-only")` at module init. Set `package.json` `exports` map to mark the Direct API entry as Node-conditioned (`"node"` only, no `"browser"`). Add a build-time CI step that imports the package from a fake browser context and asserts it throws.

---

## HIGH

### H1. `roleIds` embedded in JWT claims, used for authorization decisions

**Location:** [packages/nextly/src/auth/jwt/claims.ts](packages/nextly/src/auth/jwt/claims.ts), [packages/nextly/src/auth/handlers/login.ts:103-115](packages/nextly/src/auth/handlers/login.ts#L103-L115)

JWT signing prevents tampering, so the immediate "swap roleIds and reuse the same JWT" attack does not work. The risk is **architectural**: any client/server code that gates on `decode(jwt).roleIds` rather than re-checking the DB will desync from reality (revoked roles, demoted users) and create a parallel privilege surface that's easy to misuse. Server-side `hasPermission()` correctly hits the DB with caching — keep that as the authority.

**Fix:** Treat JWT role hints as cacheable hints only. Forbid client-side gating against JWT claims for security decisions. Add a regression test that mints a token with extra `roleIds` (signed with the real secret) and confirms server still enforces actual DB roles.

---

### H2. Open redirect via `redirectPath` in forgot-password

**Location:** [packages/nextly/src/auth/handlers/forgot-password.ts:47-56](packages/nextly/src/auth/handlers/forgot-password.ts#L47-L56)

`redirectPath` is taken from the POST body and embedded into the password-reset email link with no validation. An attacker can submit `redirectPath: "https://attacker.example/harvest"` for a victim's email — when the victim follows the legitimate-looking reset email and lands on the attacker domain, the reset token can leak in the URL/Referer.

**Fix:** Validate `redirectPath` against either (a) relative paths under `/admin` only, or (b) an env-configured host allowlist. Reject otherwise.

---

### H3. Refresh token not bound to IP/User-Agent despite being captured

**Location:** [packages/nextly/src/auth/handlers/refresh.ts](packages/nextly/src/auth/handlers/refresh.ts), [packages/nextly/src/auth/handlers/login.ts:122-131](packages/nextly/src/auth/handlers/login.ts#L122-L131)

Login stores `userAgent` and `ipAddress` alongside the refresh token, but `refresh.ts` never compares them. A stolen refresh token works from anywhere until expiry/rotation/password-change.

**Fix:** On refresh, if stored UA/IP no longer matches, delete the token row and force re-auth. Soft-fail on UA (browsers can update) and harder-fail on IP-class change (requires C4 to be fixed first; otherwise spoofable).

---

### H4. Login brute force is per-user, not per-IP

**Location:** [packages/nextly/src/auth/handlers/login.ts:57-167](packages/nextly/src/auth/handlers/login.ts#L57)

Account lockout (5 attempts → 15 min) is excellent against single-account guessing. There is no per-IP envelope, so an attacker can cycle across many usernames at full speed without ever tripping any limit on the source IP (a credential-stuffing dream). This is the same reachability pattern as C4 — a rate-limit-bypass vector compounds with this.

**Fix:** Add per-IP rate limiting on `/auth/login`, `/auth/register`, `/auth/forgot-password`, `/auth/reset-password` (e.g., 30 req/IP/hr writes). Layer on top of, not in place of, per-user lockout.

---

### H5. ReDoS via user-supplied regex in dynamic-collection validation

**Location:** [packages/nextly/src/domains/dynamic-collections/services/dynamic-collection-validation-service.ts:235-249](packages/nextly/src/domains/dynamic-collections/services/dynamic-collection-validation-service.ts#L235-L249)

`validateRegexPattern` only blocks `(?{` and `(?>` — does nothing about catastrophic backtracking like `(a+)+b` or alternation explosions. Admin (or whoever can define field validation) can DoS the API on subsequent writes/queries that exercise the regex.

**Fix:** Use `safe-regex2` (or `re2` for true linear-time matching) and cap pattern length (≤200 chars). For runtime, re2 eliminates the issue entirely.

---

### ~~H6. Field-level access control not enforced~~ — moved to _Accepted risks_ in R4

This was downgraded after maintainer review: collection-scoped (not field-scoped) access is **intentional design**, consistent with the Payload-style model the framework targets. See the new **Accepted risks / intentional design** section below for the full reasoning and what adopters need to be aware of.

---

### H7. SMTP defaults to `secure: false`, allows plaintext credentials

**Location:** [packages/nextly/src/domains/email/services/providers/smtp-provider.ts:58-66](packages/nextly/src/domains/email/services/providers/smtp-provider.ts#L58-L66)

With `secure: false` and port 25, SMTP auth is sent in cleartext. Port 587 + STARTTLS works correctly via nodemailer, so the _configuration_ is the risk, not the code.

**Fix:** Validate at startup: if `host` is not localhost and `secure: false` and port ≠ 587 (STARTTLS), throw or warn loudly. Default `secure: true` and require explicit opt-out.

---

### H8. Webhook URL validator misses IPv6 / IPv4-mapped IPv6 / DNS rebinding

**Location:** [packages/plugin-form-builder/src/handlers/webhooks.ts:414-428](packages/plugin-form-builder/src/handlers/webhooks.ts#L414-L428)

Allows `http://[::1]`, `http://[::ffff:127.0.0.1]`, `https://internal-host` that resolves to an RFC1918 address, and any private IP if the protocol is `https:`. The HTTPS allow opens the door to internal scans.

**Fix:** Resolve hostname with `dns.lookup({ all: true })`, reject if any returned IP is private/loopback/link-local/CGNAT. Also block `0.0.0.0`, `::`, and metadata services. Fix once in a shared `validateExternalUrl()` and reuse for attachments + webhooks.

---

### H9. Generated SQL embeds user-supplied schema metadata without proper escaping

**Locations:**

- [packages/nextly/src/domains/dynamic-collections/services/dynamic-collection-schema-service.ts](packages/nextly/src/domains/dynamic-collections/services/dynamic-collection-schema-service.ts) — regex `CHECK` constraint expression: `f.validation.regex.replace(/'/g, "''")` is the _only_ defense.
- [packages/adapter-drizzle/src/adapter.ts:1013-1026](packages/adapter-drizzle/src/adapter.ts#L1013-L1026) — `DEFAULT` clause for column reads `col.default.sql` straight into the DDL string when present, and string defaults are wrapped with single-quote escaping only.

DDL is **not** something Drizzle's prepared statements protect — these expressions are concatenated into raw SQL. If `validation.regex` or `col.default.sql` ever flows from a user (admin-defined collection field), it's SQL injection via DDL. Even the best-case scenario (only privileged admins can author schemas) makes this a privilege-escalation primitive: an admin gets RCE-on-DB rather than just CMS admin.

**Fix:** For regex CHECK, parameterize via the dialect's regex operator with bound values when the dialect supports it (Postgres `~`, MySQL `REGEXP`); otherwise validate the regex with a strict whitelist (no quotes, no semicolons, length cap) before embedding. **R3 update:** the existing `replace(/'/g, "''")` is _not_ sufficient even on its own terms — a crafted regex containing `)`, `(`, or unmatched anchors can break the surrounding `CHECK (… ~ '…')` constraint expression and corrupt the schema, even if it can't directly inject SQL. Allowlist the regex character set or pre-validate with a parser before embedding. For `DEFAULT`, allow only literals (numbers, booleans, quoted-and-fully-escaped strings) and an explicit set of named functions (`CURRENT_TIMESTAMP`, `now()`, `gen_random_uuid()`); reject any free-form `sql` field.

---

### H10. SECURITY.md lacks SLA, scope, PGP key, severity definitions

**Location:** [SECURITY.md](SECURITY.md)

For a beta CMS competing with Payload, "we'll respond as quickly as we can" with a single email is not enough — researchers need to know if a non-response after a week is normal or abnormal, and whether they can drop the embargo.

**Fix:** Add response SLAs (e.g., 48h ack), severity matrix, PGP key, scope (which packages, which versions), and a public-disclosure clock (e.g., 90 days standard).

---

### H11. Account enumeration via signup endpoint ⭐ NEW (R2)

**Location:** [packages/nextly/src/auth/handlers/register.ts:26-65](packages/nextly/src/auth/handlers/register.ts#L26-L65)

Forgot-password is timing-equalized + always returns success. Register is not. A duplicate-email signup returns HTTP 400 with `code: "REGISTRATION_FAILED"` and message `"User with this email already exists"`. There is no `stallResponse()` call. This is a **complete bypass of the forgot-password enumeration protection** — an attacker probes email existence via register instead.

**Fix:** Apply the same `stallResponse()` + generic message pattern that forgot-password uses. If signup must remain interactive, switch to a confirmation-email-required flow: API always returns success; the link sent to existing accounts says "you already have an account" while new accounts get the confirmation link.

---

### H12. Hardcoded salt in encryption-at-rest KDF ⭐ NEW (R2)

**Location:** [packages/nextly/src/utils/encryption.ts:14-101](packages/nextly/src/utils/encryption.ts#L14-L101)

```typescript
const SALT = "nextly-encryption-salt";
function deriveKey(secret: string): Buffer {
  return scryptSync(secret, SALT, KEY_LENGTH);
}
```

Cipher (AES-256-GCM), IV handling, and auth-tag verification are textbook-correct — the rest of this code is good. The salt is the issue. A hardcoded global salt means every Nextly install with the same `NEXTLY_SECRET` derives the same encryption key, defeating the purpose of a salt and making pre-computation attacks against the secret feasible. It also removes any per-record/per-tenant key separation, so one decryption oracle compromises every record.

**Fix:** Generate a random 16-byte salt per encryption (or per record) and store it alongside the IV/auth-tag in the encrypted blob. Format becomes `salt.iv.authTag.ciphertext`. Add a one-shot migration that decrypts with the legacy salt and re-encrypts with a random salt on first read.

---

### H13. No request body size cap; multipart limits unconstrained ⭐ NEW (R2)

**Location:** [packages/nextly/src/api/uploads.ts:272](packages/nextly/src/api/uploads.ts#L272), no global config

JSON POSTs rely on Next.js's default 1MB `bodyParser` limit (acceptable). Multipart uploads call `request.formData()` with no per-field cap, no file-count cap, and no global-payload cap — the only enforcement is the storage layer's `maxSize` (default 10MB) per file, applied **after** the entire request is buffered into memory.

**Fix (R4 scope clarification):** Expose the limits as configuration in `nextly.config.ts` rather than hard-coded values. Suggested shape:

```ts
// nextly.config.ts
export default defineConfig({
  limits: {
    json: "1mb", // body-parser cap for JSON POSTs
    multipart: "50mb", // global multipart payload cap (streaming abort)
    fileSize: "10mb", // per-file cap (already exists in storage)
    fileCount: 10, // max files per request
    fieldCount: 50, // max non-file fields per request
    fieldSize: "100kb", // max non-file field size
  },
});
```

Implement as a streaming size guard at the request layer (aborts before fully buffering oversize bodies) and wire the config through to the storage layer. Ship secure defaults so users who don't set `limits` are still protected; documented overrides for users who genuinely need higher caps (e.g., video-upload sites). Document the trade-off (memory + DoS surface scales with `multipart`).

---

### H14. Vercel Blob cannot enforce Content-Disposition for SVG uploads ⭐ NEW (R2)

**Location:** [packages/storage-vercel-blob/src/adapter.ts:106-117](packages/storage-vercel-blob/src/adapter.ts#L106-L117)

The Vercel Blob platform does not support per-object Content-Disposition headers, so SVGs uploaded via this adapter are always served `inline`. The adapter logs a one-time console warning but lets the upload proceed. Combined with C5 (no extension blocklist), this is **stored XSS as a feature**.

**Fix:** Reject `image/svg+xml` and `text/html` at the Vercel Blob adapter layer when used with untrusted-source uploads. Document that Vercel Blob is unsuitable for those types. Or: sanitize SVG with DOMPurify (server-side) before upload.

---

### H15. LIKE wildcard pattern injection in `like`/`contains`/`search` where-operators ⭐ NEW (R3)

**Location:** [packages/nextly/src/domains/collections/query/query-operators.ts:193-203](packages/nextly/src/domains/collections/query/query-operators.ts#L193-L203)

```typescript
if (operator === "like" || operator === "contains" || operator === "search") {
  const searchValue = typeof value === "string" ? `%${value}%` : String(value);
  return { column: field, op: OPERATOR_MAP[operator], value: searchValue };
}
```

The where-filter operator path wraps user-supplied search values with `%` wildcards but does **not escape** wildcards inside the value. A user submitting `like: "_"` produces `LIKE '%_%'`, which matches _any single character anywhere_ — i.e., everything. A user submitting `like: "100%"` to find titles containing the literal "100%" instead matches anything containing "100".

**Asymmetry worth noting:** the dedicated _search-API_ path at [collection-query-service.ts:1196-1237](packages/nextly/src/domains/collections/services/collection-query-service.ts#L1196-L1237) **does** correctly escape `%` and `_` with `\` — only the where-filter operator path is missing the escape. Same framework, two code paths, two outcomes.

**Impact:** This is not a classical SQL injection (Drizzle still parameterizes the bind value) but a _pattern-confusion_ bug — the framework's behavior diverges from the user's intent. A query meant as "titles containing the literal '100%'" silently broadens to "titles containing '100'", and a query meant for an underscore character matches everything. Because Nextly's access model is collection-scoped by design (see _Accepted risks_), the residual oracle risk is bounded to fields the requester is already authorized to read; the primary harm is silently-broader matches than the developer expected, which is enough on its own.

**Fix:**

```typescript
if (operator === "like" || operator === "contains" || operator === "search") {
  // Escape `\` first (it's the escape character), then the wildcards.
  const escaped = String(value)
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_");
  const searchValue = `%${escaped}%`;
  return { column: field, op: OPERATOR_MAP[operator], value: searchValue };
}
```

**Done when:** `where: { title: { like: "100%" } }` matches only titles containing the literal `100%`; `like: "_"` matches only titles containing the literal underscore character.

---

## MEDIUM

| #          | Issue                                                                                                                                                                                                                                                                                                 | Location                                                                                                                                                                                                                                                                                                               |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1         | CSRF cookie is `SameSite=Lax`; consider `Strict` for the CSRF cookie (defense-in-depth against XSS exfiltration)                                                                                                                                                                                      | [auth/cookies/cookie-config.ts:42-54](packages/nextly/src/auth/cookies/cookie-config.ts#L42-L54)                                                                                                                                                                                                                       |
| ~~M2~~     | ~~`validateOrigin()` may call `.toLowerCase()` on null~~ — **RETRACTED**, see "Retracted findings" below                                                                                                                                                                                              | —                                                                                                                                                                                                                                                                                                                      |
| M3         | No CSP/frame-ancestors defaults that actually let admin UI run; `default-src 'none'` will break SPA out of the box                                                                                                                                                                                    | [middleware/security-headers.ts:115-118](packages/nextly/src/middleware/security-headers.ts#L115-L118)                                                                                                                                                                                                                 |
| M4         | CSV export does not prefix `=`/`+`/`-`/`@` cells with `'` — Excel formula injection on form-builder export                                                                                                                                                                                            | [plugin-form-builder/src/utils/export-formats.ts:237-252](packages/plugin-form-builder/src/utils/export-formats.ts#L237-L252)                                                                                                                                                                                          |
| M5         | Storage `generateKey` doesn't reject `..` / absolute / URL-encoded path traversal in `folder` or `filename`                                                                                                                                                                                           | [packages/storage-s3/src/adapter.ts:515-518](packages/storage-s3/src/adapter.ts#L515-L518)                                                                                                                                                                                                                             |
| M6         | No rate limit on pre-signed S3 URL generation — abuse / cost amplification                                                                                                                                                                                                                            | `packages/nextly/src/api/storage-upload-url.ts` (verify)                                                                                                                                                                                                                                                               |
| M7         | `create-nextly-app` downloads template tarballs over HTTPS but does not verify checksum or signature; supply-chain risk if GitHub or any CDN in the path is compromised                                                                                                                               | [packages/create-nextly-app/src/lib/download-template.ts:43-105](packages/create-nextly-app/src/lib/download-template.ts#L43-L105)                                                                                                                                                                                     |
| M8         | docker-compose ships MinIO + Postgres + MySQL with weak/default creds and `mc anonymous set public` for the bucket. Acceptable for dev, but document loudly and consider a `docker:init` script that generates a `.env.docker.local` with random creds                                                | [docker-compose.yml:10-94](docker-compose.yml#L10-L94)                                                                                                                                                                                                                                                                 |
| M9         | Register endpoint does only `if (!email \|\| !password \|\| !name)` — no Zod schema, no email format check, no password strength check at the route layer (delegated, but route layer should also reject)                                                                                             | [auth/handlers/register.ts:46-65](packages/nextly/src/auth/handlers/register.ts#L46-L65)                                                                                                                                                                                                                               |
| M10        | No audit log for failed CSRF, failed login, password change, role assignment, user delete                                                                                                                                                                                                             | [auth/handlers/login.ts:57-167](packages/nextly/src/auth/handlers/login.ts#L57-L167) and admin handlers                                                                                                                                                                                                                |
| M11        | No row-level ownership filter in collection reads — IDOR by ID iteration if collection access is `public-read-authenticated` style                                                                                                                                                                    | [domains/collections/](packages/nextly/src/domains/collections/)                                                                                                                                                                                                                                                       |
| M12        | Code generation for collection schemas embeds field labels/names into TS source strings unescaped — broken syntax / comment-injection in generated files                                                                                                                                              | [domains/dynamic-collections/services/dynamic-collection-schema-service.ts](packages/nextly/src/domains/dynamic-collections/services/dynamic-collection-schema-service.ts), [domains/collections/services/collection-export-service.ts](packages/nextly/src/domains/collections/services/collection-export-service.ts) |
| M13        | No pre-commit secret scanning (`detect-secrets` / `gitleaks`) — relies on developer discipline                                                                                                                                                                                                        | [.husky/pre-commit](.husky/pre-commit)                                                                                                                                                                                                                                                                                 |
| M14        | `NPM_AUTH_TOKEN` set as env on broad install steps in CI; tighten to publish-only steps                                                                                                                                                                                                               | [.github/workflows/ci.yml:46](.github/workflows/ci.yml#L46), [.github/workflows/release.yml:80](.github/workflows/release.yml#L80)                                                                                                                                                                                     |
| M15        | Legacy `AUTH_SECRET` / `NEXTAUTH_SECRET` silently accepted as fallback for `NEXTLY_SECRET` (warns to console only)                                                                                                                                                                                    | [shared/lib/env.ts:59-61](packages/nextly/src/shared/lib/env.ts#L59-L61)                                                                                                                                                                                                                                               |
| M16        | Component-registry uses `new Function("m", "return import(m)")` to bypass bundler analysis — safe today since paths are config-driven; lock down the allowed module-name shape (e.g., `^@revnix/` or `^./components/`) so future "user-defined component path" features can't trivially become an RCE | [packages/admin/src/lib/plugins/component-registry.ts:296-300](packages/admin/src/lib/plugins/component-registry.ts#L296-L300)                                                                                                                                                                                         |
| M17        | MySQL adapter accepts `ssl: false` without warning even when host is remote                                                                                                                                                                                                                           | [packages/adapter-mysql/src/index.ts:651-662](packages/adapter-mysql/src/index.ts#L651-L662)                                                                                                                                                                                                                           |
| M18        | Default SQLite path `./data/nextly.db` lives inside the working tree; only the playground app `.gitignore`s it. Risk of committing user data                                                                                                                                                          | [shared/lib/env.ts:126-135](packages/nextly/src/shared/lib/env.ts#L126-L135)                                                                                                                                                                                                                                           |
| **M19** ⭐ | **Auth responses missing `Cache-Control: no-store`** — `/auth/login`, `/auth/me`, `/auth/csrf`, `/auth/refresh` returned by `jsonResponse()` do not set cache headers. A reverse proxy / browser bfcache / CDN can hold auth payloads. Only `/api/dashboard` sets `private, no-store` explicitly.     | [auth/handlers/handler-utils.ts:4-48](packages/nextly/src/auth/handlers/handler-utils.ts#L4-L48)                                                                                                                                                                                                                       |
| **M20** ⭐ | **Production source maps not explicitly disabled** — `productionBrowserSourceMaps: false` is not set in playground or admin Next config. Next.js default is currently "off" for browser source maps in prod, but explicit-false guards against future default flips and accidental opts-in.           | [apps/playground/next.config.ts](apps/playground/next.config.ts)                                                                                                                                                                                                                                                       |
| **M21** ⭐ | **No depth/complexity/pagination caps in REST query parser** — `parseWhereQuery` accepts arbitrary nesting depth; `?limit=` is not capped server-side; arbitrary AND/OR trees can be built. CPU/memory DoS + huge result-set DoS.                                                                     | [domains/collections/query/query-parser.ts:192-214](packages/nextly/src/domains/collections/query/query-parser.ts#L192-L214)                                                                                                                                                                                           |
| **M22** ⭐ | **Vercel Blob adapter `folder` param not sanitized** — same path-traversal pattern as the S3 finding; `folder` is concatenated without `..` / `/` / `\` rejection.                                                                                                                                    | [packages/storage-vercel-blob/src/adapter.ts:363-377](packages/storage-vercel-blob/src/adapter.ts#L363-L377)                                                                                                                                                                                                           |
| **M23** ⭐ | **UploadThing adapter defaults `contentDisposition: "inline"`** — same XSS-via-SVG pattern as Vercel Blob (H14) and S3 (C5). Can be overridden but not by default.                                                                                                                                    | [packages/storage-uploadthing/src/adapter.ts:56](packages/storage-uploadthing/src/adapter.ts#L56)                                                                                                                                                                                                                      |

---

## LOW / Hardening

| #   | Issue                                                                                                                                                                 | Location                                                                                                                         |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| L1  | Reset token sent as `?token=` in URL — Referer-leak risk. Switch to one-click landing → POST, or set `<meta name="referrer" content="no-referrer">` on the reset page | [auth/handlers/reset-password.ts](packages/nextly/src/auth/handlers/reset-password.ts)                                           |
| L2  | Refresh-token cookie SameSite could be `Strict` (refresh is never triggered by top-level nav)                                                                         | [auth/cookies/cookie-config.ts:45-47](packages/nextly/src/auth/cookies/cookie-config.ts#L45-L47)                                 |
| L3  | Webhook HMAC signature is generated correctly; document that consumers must use `timingSafeEqual` to verify, and provide a verification helper                        | [packages/plugin-form-builder/src/handlers/webhooks.ts:126-152](packages/plugin-form-builder/src/handlers/webhooks.ts#L126-L152) |
| L4  | CLI telemetry has env-var opt-out in code but no `--disable-telemetry` flag and no notice on first run                                                                | [packages/create-nextly-app/src/cli.ts:75-79](packages/create-nextly-app/src/cli.ts#L75-L79)                                     |
| L5  | `JSON.parse(payloadStr)` failures are silently swallowed in upload API — should at least log                                                                          | [packages/nextly/src/api/uploads.ts:282-290](packages/nextly/src/api/uploads.ts#L282-L290)                                       |
| L6  | In-memory rate limiter does not share state across processes/pods. Documented as known limitation but worth a Redis-backed alternative pre-1.0                        | [auth/middleware/rate-limiter.ts](packages/nextly/src/auth/middleware/rate-limiter.ts)                                           |
| L7  | HSTS in prod uses `max-age=31536000; includeSubDomains` — add `preload` and bump to `63072000` once you're confident no subdomain regressions                         | [middleware/security-headers.ts:169-174](packages/nextly/src/middleware/security-headers.ts#L169-L174)                           |
| L8  | `eslint-plugin-security` and `eslint-plugin-no-unsanitized` are not enabled — would catch a lot of the M-tier issues at PR time                                       | [eslint.config.mjs](eslint.config.mjs)                                                                                           |
| L9  | `tsconfig.base.json` doesn't enforce `strict: true` at the root; rely on per-package configs                                                                          | [tsconfig.base.json](tsconfig.base.json)                                                                                         |

---

## Retracted findings

### ~~M2 — `validateOrigin()` may call `.toLowerCase()` on null~~ (false positive)

Re-reading [auth/csrf/validate.ts:27-49](packages/nextly/src/auth/csrf/validate.ts#L27-L49): the function has an early `if (!requestOrigin) return false;` guard before any `.toLowerCase()` call. The `new URL(referer)` call inside the ternary _can_ throw on a malformed Referer header, but that exception propagates to the outer handler's catch and produces a 500, not a security bypass — and a 500 on a malformed-Referer CSRF request is the right outcome. Defense-in-depth would still wrap that in `try/catch`, but this is **not a vulnerability**.

---

## Accepted risks / intentional design

### A1. Field-level access control is collection-scoped by design (former H6)

**Locations:** [packages/nextly/src/domains/collections/services/collection-access-service.ts](packages/nextly/src/domains/collections/services/collection-access-service.ts), [packages/nextly/src/domains/collections/query/query-parser.ts](packages/nextly/src/domains/collections/query/query-parser.ts)

Access in Nextly is enforced at the **collection level** — a user with read on a collection can read every column on it, and the query parser allows `where` clauses on any column that exists in the schema. R4 maintainer review confirmed this is **intentional**, consistent with the Payload-style model the framework targets, prioritizing predictable response shapes and a simpler API surface over per-field rules.

**What this means for adopters:**

- **Sensitive columns must not share a collection with publicly-readable columns.** If a model needs different per-field visibility, split it into multiple collections (e.g., `users-public` vs `users-private`) and apply access rules at that boundary.
- The `users` collection's `passwordHash` column is the canonical case: it must be excluded from default response projections, never selected by default, and the framework should reject `where` filters on it explicitly. Verify response-shaping is in place (and add a regression test) — this is the one column where the "intentional design" promise rests on a different mitigation.
- For sensitive non-hash fields (e.g., `internalNotes`), the answer is "put it in a different collection" — not "expect the framework to hide it."
- This is worth surfacing in the docs as a **first-class topic**, not a footnote, since it inverts what some users will expect from a CMS.

**What this is NOT a license for:**

- It is not a reason to skip C6 (default-deny on collection access).
- It is not a reason to skip M11 (row-level ownership filter) — that's row-scoped, not field-scoped, and remains in the plan.
- It does not change H15 (LIKE wildcard escape), which is a correctness bug regardless of the access model.

---

## Mapping to requested categories

| Category                                 | Where it landed                                                                                                                                                                                                                                                               |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Injection & XSS**                      | C5 (upload XSS), H5 (ReDoS), H9 (DDL injection), H14 (Vercel SVG), **H15 (LIKE wildcard injection)**, M4 (CSV), M12 (code-gen), M23 (UploadThing inline). Drizzle parameterization is solid for the rest (see SQL Injection deep-dive results in "What's already done well"). |
| **Unauthorized access & code execution** | C6 (default-public collections), C7 (Direct API isolation), H1 (JWT roles), H11 (signup enum), M11 (IDOR), M16 (dynamic import). No `eval`/`exec` patterns observed in core. Field-level ACL is intentionally collection-scoped — see _Accepted risks_.                       |
| **Middleware & request handling**        | C4 (XFF), H13 (body limits), M3 (CSP), M9 (input validation), M10 (audit log), M19 (Cache-Control), M21 (query caps).                                                                                                                                                         |
| **MITM / transport**                     | C1 (Postgres TLS), H7 (SMTP), L7 (HSTS preload), M17 (MySQL SSL).                                                                                                                                                                                                             |
| **Authentication & authorization**       | C7, H1, H2, H3, H4, H11, L1. Bcrypt + lockout + CSRF + cookie flags + reset-token entropy are all good.                                                                                                                                                                       |
| **Password security**                    | Hashing is excellent (bcrypt cost 12, timing-safe compare). Missing: HIBP breach check, password history, MFA/TOTP.                                                                                                                                                           |
| **General OWASP / overlooked**           | C2 (insecure default ACL), C3 (SSRF), H8 (SSRF via webhook), H10 (SECURITY.md), H12 (encryption salt), M7 (supply chain), M13/M14 (CI), M8 (docker defaults), M20 (source maps), M22 (Vercel folder traversal).                                                               |

---

## What's already done well (verified positives)

- **`pnpm audit`: no known vulnerabilities** in the dependency tree (run 2026-04-27).
- **Mass assignment is safe** — explicit allowlist in the Direct API user namespace prevents `role`/`roleIds`/`passwordHash` updates via `users.update()` ([direct-api/namespaces/users.ts:122-151](packages/nextly/src/direct-api/namespaces/users.ts#L122-L151)).
- **Email header injection: safe** — Nodemailer's structured API and SendLayer's JSON object body prevent CRLF injection. No raw header construction observed.
- **First-run setup endpoint: safe** — `getUserCount() > 0` check prevents re-bootstrap ([auth/handlers/setup.ts:61-73](packages/nextly/src/auth/handlers/setup.ts#L61-L73)). CSRF protected.
- **Encryption-at-rest core is correct** — AES-256-GCM cipher, random per-encryption IV, GCM auth tag verified on decrypt, scrypt KDF. Only the hardcoded salt is the issue (H12).
- **Auth log sanitization** — explicit field-strip list in `sanitizeAuthEvent` ([shared/lib/logger.ts:205-224](packages/nextly/src/shared/lib/logger.ts#L205-L224)) drops email, tokens, passwords before logging.
- **bcryptjs cost 12** + native `bcrypt.compare` for timing-safe verify — [auth/password/index.ts](packages/nextly/src/auth/password/index.ts).
- **Brute-force lockout** (5/15min) + **timing-equalized response** (`stallResponse` ~500ms on login + forgot-password) — defeats user enumeration on those endpoints (signup gap is H11).
- **CSRF**: double-submit cookie + origin allowlist + `timingSafeEqual` compare; 256-bit token entropy — [auth/csrf/](packages/nextly/src/auth/csrf/).
- **Reset / verification tokens**: 256-bit random, SHA-256 hashed at rest, single-use (deletes prior tokens, marks `usedAt`), 24h expiry — [domains/auth/services/auth-service.ts:274-641](packages/nextly/src/domains/auth/services/auth-service.ts#L274-L641).
- **JWT**: HS256 hardcoded (no `alg=none`), `jose` for verify, JTI set, expiry enforced — [auth/jwt/](packages/nextly/src/auth/jwt/).
- **Cookies**: `HttpOnly` on access+refresh, `Secure` in prod, `SameSite=Lax`, narrow path on refresh.
- **Logout & change-password**: revoke all refresh tokens server-side — [auth/handlers/change-password.ts](packages/nextly/src/auth/handlers/change-password.ts).
- **API keys**: 256-bit secret, `sk_live_` prefix, SHA-256 hashed, raw key shown once.
- **RBAC**: role inheritance with cycle detection, super-admin bypass, multi-tier permission cache — [services/lib/permissions.ts](packages/nextly/src/services/lib/permissions.ts).
- **Drizzle ORM** for all CRUD; query parser allowlists operators and validates column existence against schema — [domains/collections/query/query-parser.ts](packages/nextly/src/domains/collections/query/query-parser.ts).
- **Email templates** auto-HTML-escape — [domains/email/services/template-engine.ts](packages/nextly/src/domains/email/services/template-engine.ts).
- **Webhook URL** validator blocks non-HTTPS (correct intent, see H8 for the gaps).
- **`drizzle-kit` pinned** to exact version.
- **`pnpm-lock.yaml` committed**, `--frozen-lockfile` in CI.
- **Comparison of storage adapters**: S3 is the most flexible (signed URLs supported, configurable ACL — once C2 is fixed); Vercel Blob is public-only by platform design (cannot be used for privacy-sensitive uploads); UploadThing is also public-only with no signed-URL support. **Recommend S3 for any deployment with non-public uploads**, and reject SVG/HTML for all three adapters.

### SQL Injection deep-dive results (R3)

A focused audit examined nine SQL-injection surfaces. Six came back **safe**, two corroborated H9, and one new finding (H15) was added. The verified-safe surfaces:

- **ORDER BY / sort field injection: SAFE** — sort field is validated against the schema object (`schema[sortField] || schema[sortFieldSnake]`) at [collection-query-service.ts:436-461](packages/nextly/src/domains/collections/services/collection-query-service.ts#L436-L461) and passed to Drizzle's `desc(column)`/`asc(column)` as a column reference, never a string.
- **LIMIT / OFFSET injection: SAFE** — `parseInt`-coerced at the dispatcher and clamped to `[1, 500]` via `clampLimit` in [pagination.ts:156-161](packages/nextly/src/types/pagination.ts#L156-L161).
- **JSON path injection: SAFE** — JSON-path filtering is not exposed in the public query API (top-level columns only); a comment in the code explicitly defers JSON-operation filtering to a future feature, so any addition will need its own audit.
- **Search-API wildcard escaping: SAFE** — `buildSearchCondition` at [collection-query-service.ts:1196-1237](packages/nextly/src/domains/collections/services/collection-query-service.ts#L1196-L1237) correctly escapes `%` and `_` before wrapping with `%…%`. (It's the _where-filter_ path that misses this — see H15.)
- **Identifier injection: SAFE** for the main paths — table/column names are quoted via `escapeIdentifier()` / `this.q`. Schema files are loaded from the file registry, not user input. (One soft alert on `user-ext-schema-service.ts:276-289` where `columnType` is interpolated unparameterized — verify `getColumnType()` validates against an allowlist.)
- **Service-layer raw queries: SAFE** — the only `sql.raw(…)` calls in service code are hard-coded `"BEGIN IMMEDIATE"` / `"COMMIT"` / `"ROLLBACK"` strings for transaction control. Multi-row `IN (…)` clauses use parameterized `sql\`${id}\``template literals joined with`sql.raw(", ")` (separator only, no user input).

---

## Remediation plan

This plan turns each Critical and High finding into an actionable task, plus the highest-leverage Mediums. Phases are gated on severity, not calendar — Phase 1 must ship before public beta, Phase 2 before 1.0.

**Effort key:** **S** ≈ 1–2 hours · **M** ≈ half-day to a day · **L** ≈ multi-day

---

### Phase 1 — Pre-beta blockers

Goal: no Critical or "easy" High remains open before public beta.

#### TASK-C1 · Postgres TLS default · **S**

- **Files:** [packages/adapter-postgres/src/index.ts:774](packages/adapter-postgres/src/index.ts#L774)
- **Fix:** Remove the `ssl = { rejectUnauthorized: false }` fallback. Default to `{ rejectUnauthorized: true }` when provider auto-detection requires SSL. Throw at startup on cert failure — never silently downgrade. Keep an explicit opt-out `ssl: { rejectUnauthorized: false }` for users who really want it (and warn loudly).
- **Done when:** Connecting to Neon/Supabase with default config rejects invalid/self-signed certs with a clear error; opt-out flag still works.

#### TASK-C2 · S3 ACL private-by-default · **S**

- **Files:** [packages/storage-s3/src/adapter.ts:116](packages/storage-s3/src/adapter.ts#L116)
- **Fix:** `acl: config.acl ?? "private"`. Update docs / README example to require explicit `acl: "public-read"` for public buckets. Ensure read flow uses signed URLs.
- **Done when:** New uploads default to `private`; existing tests updated; signed-URL read path tested.

#### TASK-C4 · `X-Forwarded-For` trust gate · **M** _(blocks H3, H4)_

- **Files:** [packages/nextly/src/middleware/rate-limit.ts:318-339](packages/nextly/src/middleware/rate-limit.ts#L318-L339), [packages/nextly/src/auth/handlers/handler-utils.ts:66-68](packages/nextly/src/auth/handlers/handler-utils.ts#L66-L68); new shared helper.
- **Fix:** Add `trustProxy: boolean` config + `TRUSTED_PROXY_IPS` env var. One `getTrustedClientIp(request)` helper used by both rate limiter and auth. Only honor XFF when peer IP is on the trust list. When honored, take the rightmost-untrusted hop (not leftmost).
- **Done when:** With `trustProxy: false` (default), spoofed XFF is ignored everywhere. With trust configured, only the configured proxy can set XFF.

#### TASK-C5 · Upload extension + magic-byte validation · **M**

- **Files:** [packages/nextly/src/services/upload-service.ts:483-515](packages/nextly/src/services/upload-service.ts#L483-L515)
- **Fix:**
  1. Extension blocklist: `html|htm|svg|svgz|xhtml|xht|shtml|xml|php*|asp*|jsp*|exe|sh|bat|cmd|js|msi|hta|cpl|scr`.
  2. Magic-byte sniff via `file-type`; reject mismatch between client-claimed Content-Type and detected type.
  3. SVG: sanitize with DOMPurify on upload **or** force `Content-Disposition: attachment` regardless of `svgCsp` flag.
- **Done when:** `evil.html` claiming `Content-Type: image/jpeg` is rejected; SVG with embedded `<script>` is sanitized or served as attachment.

#### TASK-C6 · Default-deny on collection access · **M** _(potentially breaking)_

- **Files:** [packages/nextly/src/services/access/access-control-service.ts:198-210](packages/nextly/src/services/access/access-control-service.ts#L198-L210)
- **Fix (preferred, breaking):** Change `if (!rule) return { allowed: true }` to `return { allowed: false }`. Require `access: { read: 'public' }` to opt in.
- **Fix (soft, non-breaking):** Keep current behavior but emit `console.warn()` at registration for every collection without explicit access rules; ship a `nextly audit:access` CLI that fails CI on missing rules.
- **Done when:** Either default-denies or loudly warns at startup; quickstart docs and `templates/*` updated to include explicit access rules.

#### TASK-C7 · Direct API server-only enforcement · **M**

- **Files:** [packages/nextly/src/services/lib/permissions.ts:11-15](packages/nextly/src/services/lib/permissions.ts#L11-L15), [packages/nextly/src/nextly.ts:252](packages/nextly/src/nextly.ts#L252), [packages/client/package.json](packages/client/package.json)
- **Fix:**
  1. Replace try/catch'd dynamic import with a top-of-file `import "server-only"`.
  2. Module init: `if (typeof window !== "undefined") throw new Error("Direct API is server-only")`.
  3. `package.json` exports map: mark Direct API entry as `"node":` only (no `"browser"` condition).
  4. CI step: import package from a fake browser context, assert it throws.
- **Done when:** A test importing the Direct API in a browser-like environment fails with a clear error; bundler emits a build error if the package is pulled into a client component.

#### TASK-H2 · Open redirect on `redirectPath` · **S**

- **Files:** [packages/nextly/src/auth/handlers/forgot-password.ts:47-56](packages/nextly/src/auth/handlers/forgot-password.ts#L47-L56)
- **Fix:** Validate `redirectPath` against (a) relative paths under `/admin` only, or (b) `ALLOWED_REDIRECT_HOSTS` env allowlist. On rejection, fall back to default redirect (don't include the bad path in the email).
- **Done when:** Submitting `redirectPath: "https://attacker.example"` results in the reset email using the default redirect; only allowlisted hosts are honored.

#### TASK-H7 · SMTP secure default · **S**

- **Files:** [packages/nextly/src/domains/email/services/providers/smtp-provider.ts:58-66](packages/nextly/src/domains/email/services/providers/smtp-provider.ts#L58-L66)
- **Fix:** Default `secure: true`. Startup validation: if remote host + `secure: false` + port ≠ 587 (STARTTLS), throw. Localhost exempt for dev.
- **Done when:** Misconfigured remote SMTP on plaintext port 25 throws at startup; localhost dev remains usable.

#### TASK-H8 · Shared `validateExternalUrl` helper · **M** _(also closes C3)_

- **Files:** [packages/plugin-form-builder/src/handlers/webhooks.ts:414-428](packages/plugin-form-builder/src/handlers/webhooks.ts#L414-L428), [packages/nextly/src/di/registrations/register-email.ts:68-88](packages/nextly/src/di/registrations/register-email.ts#L68-L88), new `packages/nextly/src/utils/validate-external-url.ts`.
- **Fix:** New helper:
  1. Parse URL; require `https:` (or `http://localhost` in dev).
  2. `dns.lookup({ all: true })` → reject if any returned IP is RFC1918, loopback, link-local, CGNAT, or `0.0.0.0`/`::`/`169.254.169.254`/`169.254.169.253`.
  3. Pin the validated IP for the actual fetch (defends against DNS rebinding) — or re-resolve immediately before fetching with a custom agent.
- **Done when:** `https://[::1]`, `https://10.0.0.1`, `https://internal-host` (resolving to RFC1918) all rejected. Used by both webhook validator and email-attachment fetcher.

#### TASK-H10 · SECURITY.md hardening · **S**

- **Files:** [SECURITY.md](SECURITY.md)
- **Fix:** Add response SLAs (e.g., 48h ack), severity matrix, PGP key, scope (which packages, supported versions), 90-day public-disclosure clock, optional security advisories link.
- **Done when:** Researchers know exactly when to expect a response, what's in scope, and have an encrypted contact path.

#### TASK-H11 · Signup enumeration parity · **S**

- **Files:** [packages/nextly/src/auth/handlers/register.ts:26-65](packages/nextly/src/auth/handlers/register.ts#L26-L65)
- **Fix:** Wrap handler with the same `stallResponse(startTime, deps.loginStallTimeMs)` used by forgot-password. Replace `"User with this email already exists"` with generic `"Check your email to complete registration"`. For existing accounts, send a "you already have an account" email instead of erroring.
- **Done when:** Response time and body are byte-identical between fresh-email and existing-email registrations.

#### TASK-H13 · Body / multipart size caps via `nextly.config.ts` · **M**

- **Files:** [packages/nextly/src/api/uploads.ts:272](packages/nextly/src/api/uploads.ts#L272), middleware, config schema in `packages/nextly/src/config/`
- **Fix:**
  1. Add a `limits` block to the `nextly.config.ts` schema:
     ```ts
     limits: {
       json?: string;        // default "1mb"
       multipart?: string;   // default "50mb"
       fileSize?: string;    // default "10mb"
       fileCount?: number;   // default 10
       fieldCount?: number;  // default 50
       fieldSize?: string;   // default "100kb"
     }
     ```
  2. Implement a streaming size guard at the request layer that aborts above the configured `multipart` cap before the body is fully buffered.
  3. Wire `fileSize`/`fileCount`/`fieldCount`/`fieldSize` into the multipart parser; reject early on overflow.
  4. Document each knob in the config reference, including the trade-off (memory + DoS surface scales with `multipart`).
- **Done when:** A 500MB multipart body is rejected before being fully buffered when defaults are in effect; users who set `limits.multipart: "200mb"` in `nextly.config.ts` can upload up to 200MB; the JSON cap is also configurable via `limits.json`.

#### TASK-H14 · Reject SVG/HTML on Vercel Blob · **S**

- **Files:** [packages/storage-vercel-blob/src/adapter.ts:106-117](packages/storage-vercel-blob/src/adapter.ts#L106-L117)
- **Fix:** Hard-reject `image/svg+xml` and `text/html` at the adapter (since the platform can't enforce attachment-disposition). Replace the one-time warn with a thrown error. Document the limitation in the adapter README.
- **Done when:** Uploading SVG via Vercel Blob throws a clear error explaining the platform limitation and pointing to S3 as the alternative.

#### TASK-H15 · Escape LIKE wildcards in where-filter operators · **S**

- **Files:** [packages/nextly/src/domains/collections/query/query-operators.ts:193-203](packages/nextly/src/domains/collections/query/query-operators.ts#L193-L203)
- **Fix:** Before wrapping `value` with `%…%`, escape `\`, `%`, and `_` (in that order — backslash first since it's the escape char). Mirror the escaping already done correctly in `buildSearchCondition` at [collection-query-service.ts:1196-1237](packages/nextly/src/domains/collections/services/collection-query-service.ts#L1196-L1237) so both code paths behave the same way. Add a unit test asserting `like: "100%"` matches only the literal `100%` substring and `like: "_"` matches only the literal underscore.
- **Done when:** The where-filter `like`/`contains`/`search` operators behave identically to the search-API path with respect to wildcard handling; users can search for literal `%` and `_` characters.

---

### Phase 2 — Pre-1.0 hardening

Goal: close remaining Highs and the highest-leverage Mediums.

#### TASK-H3 · Refresh-token UA/IP binding · **S** _(depends on TASK-C4)_

- **Files:** [packages/nextly/src/auth/handlers/refresh.ts](packages/nextly/src/auth/handlers/refresh.ts)
- **Fix:** Compare stored `userAgent` and `ipAddress` against current request via the same `getTrustedClientIp` helper from C4. Soft-fail UA (browsers update); hard-fail on IP-class change → delete token, force re-auth.
- **Done when:** A refresh token used from a different IP after the trusted-proxy gate is in place fails and the row is deleted.

#### TASK-H4 · Per-IP rate limit on auth endpoints · **M** _(depends on TASK-C4)_

- **Files:** [packages/nextly/src/auth/middleware/rate-limiter.ts](packages/nextly/src/auth/middleware/rate-limiter.ts), wired into login/register/forgot/reset.
- **Fix:** 30 req/IP/hr cap on `/auth/login`, `/auth/register`, `/auth/forgot-password`, `/auth/reset-password`. Layer on top of per-user lockout, not in place of it.
- **Done when:** Cycling through 100 usernames from one IP gets rate-limited at 30; per-user lockout still trips at 5.

#### TASK-H5 · ReDoS-safe regex for collection validation · **S**

- **Files:** [packages/nextly/src/domains/dynamic-collections/services/dynamic-collection-validation-service.ts:235-249](packages/nextly/src/domains/dynamic-collections/services/dynamic-collection-validation-service.ts#L235-L249)
- **Fix:** Replace `new RegExp(pattern)` validation with `safe-regex2`. For runtime matching, use `re2` (linear-time, no backtracking). Cap pattern length ≤200.
- **Done when:** `(a+)+b` rejected at field-validation creation time; runtime matching can't be CPU-DoS'd by adversarial input.

#### ~~TASK-H6 · Field-level access control~~ — **dropped (R4)**

The underlying H6 finding has been moved to _Accepted risks / intentional design_. No code change planned. Adopters who genuinely need field-level access should split sensitive columns into separate collections (e.g., `users-public` vs `users-private`) and apply collection-level rules at that boundary. Document this pattern in the docs site so adopters don't try to put `passwordHash` in the same collection as user-facing fields.

#### TASK-H9 · DDL escaping for dynamic schema · **M**

- **Files:** [packages/nextly/src/domains/dynamic-collections/services/dynamic-collection-schema-service.ts](packages/nextly/src/domains/dynamic-collections/services/dynamic-collection-schema-service.ts), [packages/adapter-drizzle/src/adapter.ts:1013-1026](packages/adapter-drizzle/src/adapter.ts#L1013-L1026)
- **Fix:**
  1. Regex CHECK: validate regex against strict whitelist (no quotes, no semicolons, length cap) before embedding; or parameterize via `~`/`REGEXP` with bound values where dialect supports it.
  2. Column DEFAULT: allow only literals (numbers, booleans, fully-escaped strings) and named functions from a small allowlist (`CURRENT_TIMESTAMP`, `now()`, `gen_random_uuid()`). Reject any free-form `sql` field.
- **Done when:** A regex containing `'); DROP TABLE users; --` is rejected at schema-create; `col.default.sql = "'; SELECT pg_sleep(10); --"` is rejected.

#### TASK-H12 · Per-encryption random salt · **M**

- **Files:** [packages/nextly/src/utils/encryption.ts:14-101](packages/nextly/src/utils/encryption.ts#L14-L101)
- **Fix:** Generate 16-byte random salt per encryption. New blob format: `salt.iv.authTag.ciphertext` (hex). Migration: try new format first; on parse-fail, fall back to legacy hardcoded salt and re-encrypt on next write.
- **Done when:** Two encryptions of the same plaintext yield different ciphertexts; existing records still decrypt; new writes use new format; rollout doesn't require a downtime migration.

#### High-leverage Mediums to ship in Phase 2

| Task                                             | Effort | Summary                                                                                                                                                                             |
| ------------------------------------------------ | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **TASK-M3** · CSP defaults that work             | S      | Replace `default-src 'none'` with admin-runnable defaults; document customization.                                                                                                  |
| **TASK-M9** · Zod schema on `/auth/register`     | S      | Email format, password strength, name length checks at the route layer.                                                                                                             |
| **TASK-M10** · Audit log subsystem               | L      | Log failed CSRF, failed login, password change, role assignment, user delete with timestamp/actor/IP/UA. Tamper-evident table.                                                      |
| **TASK-M11** · Row-level ownership filter        | M      | Enforce `owner-only` rules via WHERE clauses (not post-retrieval filtering). Note: this is row-scoped, not field-scoped — field-level ACL was accepted as out of scope (former H6). |
| **TASK-M13** · Pre-commit secret scan            | S      | Add `gitleaks` or `detect-secrets` to husky pre-commit + GitHub Action.                                                                                                             |
| **TASK-M19** · `Cache-Control: no-store` on auth | S      | Patch `jsonResponse()` to default no-store when path matches `/auth/*`.                                                                                                             |
| **TASK-M21** · Query depth + pagination caps     | S      | Cap nesting depth (5), conditions (50), `limit` (200) in the parser.                                                                                                                |
| **TASK-M22** · Vercel Blob folder sanitization   | S      | Same pattern as the S3 finding; reject `..`, `/`, `\` in folder.                                                                                                                    |
| **TASK-M23** · UploadThing `attachment` default  | S      | Flip default `contentDisposition` in the adapter.                                                                                                                                   |

---

### Phase 3 — Roadmap (post-1.0)

Not blockers, but each unlocks a meaningful security or compliance posture.

| Item                                                          | Why it matters                                                                                                                                        |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **MFA / TOTP**                                                | TOTP secret generation, QR provisioning, recovery codes, ±30s window validation. Single-largest ATO mitigation after password leaks.                  |
| **HIBP breach-list check**                                    | Async k-anonymity API call on registration + password change. Stops the worst passwords from entering the system.                                     |
| **Password history**                                          | Reject reuse of last 3 hashed passwords. Compliance requirement for many industries.                                                                  |
| **Redis-backed rate limiter**                                 | Replaces in-memory limiter for multi-instance / serverless deployments. Pluggable backend interface.                                                  |
| **Signed template tarballs**                                  | Checksum + signature verification in `create-nextly-app` download flow. Closes M7.                                                                    |
| **`eslint-plugin-security` + `eslint-plugin-no-unsanitized`** | Catches a lot of M-tier issues at PR time. Roll out package-by-package.                                                                               |
| **Threat model document**                                     | Required for B2B sales (vs. Payload). Captures trust boundaries, asset inventory, attack scenarios.                                                   |
| **Runtime IDOR fuzz suite**                                   | Generate random IDs and verify access denied. Catches M11 regressions and the response-projection promise that the field-ACL accepted-risk relies on. |
| **`__Host-` cookie prefix**                                   | Extra browser-enforced binding to HTTPS + path + no-Domain.                                                                                           |
| **Backup encryption**                                         | Encrypt `docker:backup` output; document key management.                                                                                              |
| **GDPR / RTBF path**                                          | Cascading delete or anonymization for "delete user" — required for EU users.                                                                          |

---

## Verification methodology used

- **R1 — Initial audit:** 5 parallel domain-focused Explore agents (auth, injection, request handling, file uploads/SSRF/RCE, transport/secrets/deps).
- **R2 — Verification round (2026-04-27):**
  - `pnpm audit` (clean — no known vulnerabilities).
  - 4 parallel verification queries:
    1. Mass assignment + signup enumeration + Direct API server-only + default REST exposure + CSRF false-positive verification.
    2. Vercel Blob + UploadThing storage adapters end-to-end.
    3. Body limits + email header injection + setup endpoint + encryption-at-rest internals + source maps + Cache-Control + log injection.
    4. (Other targeted reads as needed.)
- **R3 — SQL injection deep-dive (2026-04-28):** focused audit across 9 surfaces (sort, limit, LIKE wildcards, JSON paths, `sql.raw`/`sql.unsafe` usage, identifier injection, full-text search, migration generation, service-layer raw queries). Found H15; corroborated H9; verified 6 surfaces clean.

## Caveats / not-yet-done

- **Runtime fuzzing** — none performed. Findings on H13 (body caps), M21 (query caps), M11 (IDOR) would benefit from actual exploit attempts.
- **Git history secret scan** — `gitleaks --log-opts="--all"` not run.
- **Dependency review beyond CVEs** — no review for deprecated/abandoned packages, typosquats, or maintainership health.
- **Threat-model document** — there isn't one; for compliance/B2B sales (vs. Payload), one will be required.
- **OAuth/SSO flows** — not present in the codebase; if added later, will need its own audit.
- **Live admin UI XSS testing** — not performed; React's default escaping makes most of admin XSS-resistant, but `dangerouslySetInnerHTML` usage and rich-text editor settings should be runtime-tested against payloads.
