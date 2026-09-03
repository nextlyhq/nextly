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

Copying a block subtree can now keep the links it makes to itself.

A saved pattern whose button links to `#pricing` further down the same pattern
used to arrive with the link intact and the target gone: copying assigns fresh
ids and dropped the HTML `id` attributes, because two copies on one page must
not answer to the same anchor. The link then resolved to whatever `#pricing`
the destination page happened to own, or to nothing at all, and only on the
rendered page.

Those ids are now given new values instead of being removed — derived from the
original, so `pricing` becomes something an author still recognises in a URL,
a stylesheet and the attribute panel — and the copy reports what each one
became, so whatever holds the reference can follow it.
