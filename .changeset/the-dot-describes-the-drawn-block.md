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

The provenance dot now describes the block the canvas is actually drawing.

The editor prepares a stored document before it renders — repairing duplicate ids, withholding
condition-gated nodes, dropping subtrees that a placeholder replaces. The cascade was read from that
prepared tree while the panel looked its selected block up in the stored one, so where the two
differed the dot could describe a different block than the one on screen: a class you can see
applied would read as set by nobody, or be credited to the wrong place.

The declarations and the tree they describe now travel together, so the panel cannot resolve a block
in one and read its values from the other.

Two smaller fixes alongside it. The inspector no longer rebuilds its breakpoint subscriptions on
every keystroke. And a block the editor is not drawing at all now shows no dot, which is the honest
answer for something that is not on the page.
