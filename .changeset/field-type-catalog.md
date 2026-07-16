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

Every field type is now described in one place, and the admin's pickers read from it.

**New: `nextly/field-catalog`.** A browser-safe, pure-data module describing all 18 built-in field types — key, label, picker category, one-line hint, and icon name — plus `narrowFieldTypeCatalog()` for taking a surface's typed subset. The schema builder's field picker and the user-field type picker both render from it now, so the same field type can no longer be described differently on different screens (the user-field picker's labels and hints updated to the shared wording, e.g. "Textarea" is now "Long text" everywhere).

**Removed: a drifted duplicate field model inside the admin.** An older, unused set of per-type field editors and their separate field-type definitions had fallen out of sync with the live schema builder and was reachable by nothing. It is deleted rather than left to mislead.

`@nextlyhq/admin` now declares `nextly` as a peer dependency. Every real admin install already runs inside a Nextly app, so this formalizes what was always true rather than adding a new requirement.
