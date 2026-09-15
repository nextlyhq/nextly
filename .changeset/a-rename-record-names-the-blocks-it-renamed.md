---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/builder": patch
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
"nextly": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-mcp": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/ui": patch
---

Saving part of a page as a pattern no longer gives a block an id it never had.
When a pattern is inserted beside an element that already uses one of its ids,
the insert renames the copy (`pricing` becomes `pricing-4985ccb3`) and records the
rename, so a later save can store the pattern under its own name again. That
record said what an id became but not which block it belonged to, so a block
added afterwards and given the renamed id was also saved as `pricing`.

An insert now also records which blocks it renamed, as `renamedNodes` beside
`renamed` on the inserted root's `origin`. A save restores an id only on a block
listed there that still exists once on the page and still carries the renamed
id. A block that was deleted, whose id was changed, or that was added later
keeps the id it has. Hiding a block behind a visibility condition does not
change this.

Existing pages behave as they do today. A pattern inserted before this release
has no such list, and saving from it restores by id exactly as before, including
the case above. Inserting the pattern again writes the list, and saving over a
pattern keeps whichever form its record already has. `patternRenameRecord` reads
a stored record's renames and its list together, in one pass.
