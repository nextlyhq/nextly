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

A plugin can now ask whether a collection stores a working draft when that collection was
created through the SCHEMA BUILDER rather than written in config.

`collectionDraftSplit` answers for authored config. A Builder collection is not that: it lives
in the dynamic registry, and the registry stores `versions` already RESOLVED -
`dynamic_collections.versions` holds `{ drafts: { enabled } }`, not the `true` or
`{ drafts: true }` an author writes. Handing that record to the authored form is rejected by
the checker, and from untyped code it answers `false` for a collection whose drafts are ON,
because nothing named `drafts.enabled` is there to read.

That failure is silent and total for a whole class of collections. A plugin keying its own
data by published/draft would omit every Builder collection's draft entirely while reporting
success - and the page-builder's class-usage index is exactly such a plugin, so this is a
prerequisite for it rather than a convenience.

`resolvedCollectionDraftSplit` takes the registry's record. The function already existed and
already took this shape; it was reachable from no public entry, so a plugin that could FETCH a
Builder collection had no supported way to ask this of it.

Two functions rather than one accepting either, and the type test asserts they reject each
other in both directions. The inputs overlap in neither, and a single function would have to
guess which it was handed - `versions: true` and `{ drafts: { enabled: true } }` are both
values a runtime check can misread, and guessing wrong fails in the direction that silently
disables drafts. Which one to call is decided by where the collection came from, which the
caller knows and the value does not say.

Renamed at the boundary. Internally it is `schemaDraftSplit`, named for the caller it was
written for; a published name has to say what it TAKES, because that is the only thing a
plugin author choosing between the two can see.
