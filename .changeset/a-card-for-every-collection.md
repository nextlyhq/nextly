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
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
"@nextlyhq/plugin-form-builder": patch
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
"create-nextly-app": patch
"nextly": patch
---

Your dashboard can show your own content.

Every collection your project has now offers two cards through the "Add a
widget" picker: how many entries it holds, and the entries changed most
recently. They are built from the collections your install actually has, read
when the page loads -- so a collection you draw in the Schema Builder can be
added to your dashboard straight away, without a restart.

They are OFFERED, never placed for you. An install with forty collections would
otherwise open onto eighty cards you did not ask for, and removing seventy-seven
of them is not a dashboard. Add the ones you want.

A card only appears where it can be honest. A collection with no field that names
its entries gets no "recent" list, because every row would read as an identifier;
one with no timestamps gets none either, because "recently" would have nothing to
sort by. And each card carries the same permission that gates the collection, so
you are only offered cards for content you can read.
