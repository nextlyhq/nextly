---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"create-nextly-app": patch
"nextly": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/ui": patch
---

Single edit forms no longer ask for a title and slug. A Single is a one-instance document whose identity is fixed by its config (`label` + `slug`), but the admin previously rendered title and slug as editable, required inputs — forcing redundant input for values already determined by the definition.

The single edit form now shows the title (from the single's `label`) and slug (from the configured `slug`) as read-only, non-editable fields, and submitting never errors on them. `EntrySystemHeader` and `EntryMetaStrip` gain opt-in `lockIdentity`/`lockSlug` flags (default off, so collection entry forms are unchanged); for singles the title/slug are seeded from config, the client validation for those two fields is relaxed, and slug auto-generation is disabled.
