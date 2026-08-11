---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/ui": patch
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
---

fix(admin): replace one part of the email provider form without resetting the rest

Changing a provider type, or a plugin returning while the form is open, replaced
the configuration through a whole-form reset. That makes every current value the
form's new baseline, so fields it never meant to touch stop differing from it —
and reconciling a refetch keeps only what still differs. A rename typed before
either of those happened was silently overwritten by the record's own value.

Each of those now writes only the fields it means to, and a provider type chosen
in the picker is kept as the operator's until they save. A descriptor that gains
a configuration field while a form is open now initialises it, so a switch no
longer draws a position the form does not hold, and a field being edited is left
alone.
