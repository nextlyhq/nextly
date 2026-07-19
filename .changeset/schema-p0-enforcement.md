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
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/ui": patch
---

The schema system now enforces what it promises.

Every entry write — admin, REST, Direct API, bulk, or forms — is validated server-side against the collection's field rules (required, length, range, pattern, options, row bounds), and failures come back with per-field paths the admin renders inline on the exact field. Field-level `validate`, `access`, and `hooks` in code-first configs now actually execute: custom validators run in the write gate, per-field access strips denied fields from writes and reads, and all four field-hook phases fire at their documented points.

Password fields are finally honest about "Hashed at rest": values are bcrypt-hashed before storage, never returned by any read or mutation response, and edit forms treat a blank input as "keep the current password".

The standalone `nextly/api/*` route handlers now authenticate for real — verified session or API key plus the same RBAC permissions their admin-API twins require — replacing a header-presence check; media routing consolidates onto the authenticated `media-handlers` surface, and pre-signed upload URLs require create-media.

Schema apply endpoints and the `ui-schema.json` mirror now validate fields with one shared schema, so a change can no longer apply to the database while silently failing to reach the committed manifest (upload fields no longer require the `relationTo` the builder never collects), and a failed manifest sync after a delete surfaces as a warning instead of disappearing.
