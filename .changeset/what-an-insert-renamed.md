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

An inserted pattern now records the DOM ids it had to rename, and saving that
copy back stores the ids the source actually uses.

Inserting a pattern renames a DOM id when the destination page already holds
that name. The renamed id is a fact about that page, not something an author
wrote — so a copy edited and saved back over its own pattern was stored carrying
it. That moved the pattern's fingerprint on a save that changed nothing, told
every other copy it was stale, and grew the id by another suffix on each
insert-save cycle, without bound.

The insert records what it changed, alongside the provenance it already writes,
and the save puts it back — references included, so a `aria-describedby` or a
`#fragment` follows the id it names.

Recorded rather than derived, because the original cannot be recovered from the
current value: a minted id is the authored one plus a suffix taken from a node
id, and content from a script or an import may name anchors that way on purpose.

Nothing to migrate. A record written before this field existed carries no rename
map, which says exactly what an empty one says — restore nothing — so an older
document behaves as it does today.

A component definition can also be duplicated. Its exposed properties and slot
regions are pointers INTO its tree, so a copy that re-identifies the nodes
without re-aiming them loads, renders, shows its properties in the inspector,
and fails its own publish gate with one error per exposure. Exposed ids are kept,
because variant presets are keyed by them; DOM ids are kept, because the
duplicate is a document of its own.
