---
"nextly": patch
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"@nextlyhq/ui": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"create-nextly-app": patch
---

Move `nodemailer` to `^9.0.1` (from `^8`) to pick up the patched line for the message-level `raw` file-access bypass advisory. The SMTP provider builds messages from structured fields and never uses the `raw` option, so this was not reachable, but the dependency is now on a supported, patched release.

The monorepo's transitive and toolchain dependencies were also refreshed to their patched releases via `pnpm` overrides (undici, dompurify, next, vite, ws, vitest, js-yaml, fast-uri, fast-xml-builder, @babel/core, tar, turbo), clearing the outstanding security advisories.
