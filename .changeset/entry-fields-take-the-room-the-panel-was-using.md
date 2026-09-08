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
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

Editing an entry now gives the fields the room the document panel was taking.

The panel on the right sat inside the same column as the fields, so its width
came out of theirs. On a 1680px screen the widest field an author could type
into was about 800px of a 1352px area, with the panel accounting for most of
the difference.

The page now takes the full width and the FIELDS carry the reading width
instead, with the panel beside them rather than inside them. The same screen
now gives 968px to the fields; a wider display caps them at a comfortable
reading width and leaves the rest as margin, so lines never grow unreadably
long. Creating an entry is unchanged, because it has no panel to reclaim
space from.

Pages that have no panel are untouched, including any edit screen supplied by
a plugin: a page takes the full width only when its own content says it will
bound itself, so nothing is widened that has nothing to gain from it.

Also removes an unused placeholder component from the admin that rendered a
stray product name and was referenced nowhere.
