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

Media URLs returned from the API are now absolute. Previously, the local storage adapter wrote `/uploads/...` paths and surfaced them verbatim in API responses — mobile clients, edge workers, and any consumer without the deployment's origin baked in could not resolve the URL. Now, `MediaService` responses, populated `media` relations on entry responses, and the collection upload handlers (`POST` / `GET /admin/api/collections/<slug>/uploads`) prefix relative URLs with `NEXT_PUBLIC_APP_URL` (priority: `emailConfig.baseUrl` override > `NEXT_PUBLIC_APP_URL` > `http://localhost:3000` in dev). Cloud-adapter URLs (S3, Vercel Blob, R2) are already absolute and pass through unchanged. Consumers that previously concatenated the base URL themselves should drop the prefix — double-prefix detection is in place, but the new behaviour means the prefix is no longer needed. The env schema already requires `NEXT_PUBLIC_APP_URL` in production, so the localhost fallback is only reachable in development.

Internal: extracted a shared `getBaseUrl(override?)` helper at `src/shared/lib/get-base-url.ts` so the email service and the new media-absolutization path resolve through one priority chain. `EmailService.getBaseUrl` and the new `getMediaBaseUrl` both delegate to it.
