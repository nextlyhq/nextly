---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
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
---

Schema Builder tables keep the text column width they had. Creating a field group or single routed its columns through the shared descriptor, which read a text field with no stated width as bounded where the previous generator read it as unbounded, so on MySQL a new text column held 255 characters instead of 65 535.

A text field that states its own width now gets a column at exactly that width, on every path that can build one: a field limited to 400 characters no longer lands in a column that rejects what its own validation accepts. Localized companion migrations, Single identity seeding, and columns added to an existing table all recognise the bounded text column, so a freshly generated migration applies, a new Single keeps its seeded title and slug, and a column added at boot is not reported as changed on the next preview.
