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

Unified upload validation across both upload paths. `/api/media` now applies the same filename hygiene, extension blocklist, MIME allowlist, magic-byte sniff, and SVG sanitization that `/admin/api/collections/[slug]/uploads` already had — previously the global Media endpoint accepted any MIME type and any byte content up to 10MB with no sanitization. Validation logic is extracted into `services/upload-validation/`, both `UploadService` and `MediaService` call its `validateAndSanitizeUpload` entrypoint, and every validation failure now throws `NextlyError.validation` with a stable machine code (`FILENAME_INVALID`, `EXTENSION_BLOCKED`, `MIME_BLOCKED`, `MIME_NOT_ALLOWED`, `SIZE_EXCEEDED`, `MAGIC_BYTE_MISMATCH`, `SVG_SANITIZATION_FAILED`, `UNSUPPORTED_FOR_BACKEND`). The SVG sanitizer is tightened from `USE_PROFILES: { svg, svgFilters }` alone to explicit `FORBID_TAGS` (`foreignObject`, `animate*`, `image`, `iframe`, `object`, `embed`, `audio`, `video`, `source`, `track`, `style`) plus `FORBID_ATTR` (event handlers, `formaction`, `xlink:show`/`actuate`) and an `uponSanitizeAttribute` hook that strips any `href`/`xlink:href` whose value isn't fragment-only (`#id`). DOCTYPE declarations are stripped before sanitization to defang XML billion-laughs entity expansion, and a 2MB SVG-specific size cap is enforced separately from the general per-file limit. The magic-byte check closes a real polyglot bypass: claiming `image/svg+xml` with non-SVG bytes (or claiming a non-SVG type with XML bytes) is now rejected before the sanitizer runs.

Breaking: `UploadService.upload()` now throws `NextlyError.validation` on validation failures instead of returning `{ success: false, errors, … }` — storage-layer 5xx failures still return the result-shape. `/api/media` rejects files outside the default MIME allowlist (override via `security.uploads.allowedMimeTypes` or `additionalMimeTypes`). SVG uploads with `<foreignObject>`, external `href`, animations, `<style>` blocks, or `data:` URIs will have those elements stripped — sanitized output may differ from input. `@nextlyhq/storage-vercel-blob` now supports SVG uploads (previously refused). The adapter returns Vercel Blob's `downloadUrl` (the file URL with `?download=1` appended) when the upload requests `contentDisposition: "attachment"`, so direct top-level navigation forces an attachment download while `<img src>` rendering remains unaffected. HTML uploads continue to be rejected with `NextlyError.validation` (code `UNSUPPORTED_FOR_BACKEND`, HTTP 415) — they're unsafe to host on a shared blob CDN regardless of disposition. `storage-local` cannot set per-file headers via Next.js static serving; sanitization still runs so stored bytes are safe, but self-hosters who want strict response headers should serve through a CDN with a response-header policy.

A new structured event `nextly.upload.rejected` is emitted on every validation failure with `{ code, route, mimeType, filename, size }` so operators can alert on attack-pattern spikes (sudden bursts of `MAGIC_BYTE_MISMATCH` or `EXTENSION_BLOCKED` indicate polyglot probing).

Build/dependency: the `pnpm.overrides` block now bumps `undici` to `^7` to fix a pre-existing latent runtime bug — `jsdom@28` (a transitive dep of `isomorphic-dompurify`) requires `undici@7+`'s `lib/handler/wrap-handler.js`, but the workspace was resolving `undici@6.25.0`. Any SVG upload through the existing pipeline would have crashed in production; no test exercised that path so it was undetected.
