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

The page builder now records which documents embed which components, in a
`nx_pb_component_usage` collection maintained automatically as pages are saved
and deleted. Nothing surfaces it yet; it is what will let the library say a
component is used on N pages, and let deleting one tell you what still embeds
it instead of quietly breaking those pages.

It is maintained by the same write-path pass that already keeps the class usage
index, so a save reads each document once and both indexes derive from that
read rather than the document being read twice.

A page too large to read whole records that fact rather than recording nothing,
because "embeds no components" is the answer that would make deleting one look
safe.

Repairing the indexes is now one call, `rebuildPageBuilderUsageIndexes`, which
takes the document store and both index stores and repairs every index the
plugin maintains — it names the set itself, so an index added in a later
version is repaired without a caller having to know it exists.
`rebuildClassUsageIndex` still works and still repairs the class index alone;
it is deprecated for one release because that narrowness is exactly the trap —
a site that upgraded and ran it would have left its component index empty, and
an empty index reports every component as used nowhere.
