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
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-mcp": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

The template form no longer draws an own design's bookkeeping as inputs. `entry`, `entryCollection`, `entryId` and `forkedFrom` are declared `admin.hidden`, so they stay what every write path, the guard and the reads use, and an own design's panel says them read-only under "Own design": the entry it serves (opening it), that entry's collection by name, its id, and the template it was copied from, or that it was since deleted. A template's collection is shown by its name ("Posts"), with its slug beside it, and read-only once the template exists; a template being made chooses its collection by name from those the author may read that have a `slug` field, and a saved one whose collection is no longer listed stays read-only by its slug unless that collection was removed or renamed, asked through a new `GET /templates/collection-exists` route for template editors, when it may choose another, as the guard allows. A new template's choice waits until the pages collection's slug is known, so Pages is never offered. An own design no longer shows an empty Collection. Delete template, and Remove own design in an entry's Design section, confirm in the page builder's confirming red, the deeper shade under the white label in the light theme, as Delete component does. In any entry form, a row whose fields all draw nothing (hidden, or with a condition that does not hold) no longer leaves a gap, so an own design's form no longer opens with a blank band above its Template field. An install made from unreleased `main` keeps drawing the four fields until its templates collection's stored definition is next written, since a field's admin options alone do not rewrite it.
