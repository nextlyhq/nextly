---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
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

Fix three content-integrity edge cases.

- Media focal-point crop regeneration no longer deletes an image's old size
  variants before the row commits. New variants are written to fresh keys, the
  row is committed pointing at them, and the superseded old files are deleted
  only afterwards — so a failed or lost-race write can no longer leave a media
  item referencing files that were already deleted.
- A localized single's translatable field defaults (including a localized
  title/slug) are now seeded onto its default-locale companion row when the
  single is auto-created, instead of resolving to null until first written.
- Turning on Draft/Published for an already-localized entity now back-fills the
  default-locale companion status from the main row, so a later publish of the
  default locale is recognized as a real transition (and fires its webhook)
  rather than a no-op against a status that was wrongly reset to draft.
