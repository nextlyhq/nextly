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
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

Add `core/column` as a real block and restrict `core/columns` to accept only columns, so a column can carry its own width, background and alignment.

A block whose slot refuses it is now reported by the repair banner and repaired by WRAPPING it in the one type the slot admits, so a page stored with loose children in a columns row can be fixed without discarding them. The block library's Insert button applies the same drop rules a drag does, inserting into the nearest place that accepts the block and reporting when there is nowhere. Slots declare whether they lay their children out with flex or grid, so the canvas stops interleaving drop zones that would become cells of that layout.

A block can declare the parents it may sit under — `parent`, matching the field of the same name in Gutenberg's block metadata — enforced on the editor and the write path alike, with the repair banner offering to wrap a stray block in the parent it names. This is the half a slot's `allow` list cannot express: a slot naming a type must not confine that type to it, and a block that is meaningless outside one parent has to say so itself.

It is declared on `@nextlyhq/blocks-engine`'s `BlockDefinition`, so it reaches plugin authors through `@nextlyhq/plugin-sdk/blocks` alongside every other block field. A contributed block's nesting rules are enforced by the page builder as well: the drop rules, the write validator, the repair finder and the node constructor now resolve a block's slots and permitted parents through the engine registry when this package's own does not hold it, so a plugin container's named slots are offered and its `parent` restriction is applied. Slot allow-lists honour the engine's namespace wildcard (`core/*`) wherever they are read, rather than only exact names.

`core/column` uses `parent` so inserting a Column while one is selected produces a sibling in the row rather than a column nested inside a column.

`blocks.manifest.json` carries `parent`, and its `manifestVersion` moves to **2**. That artifact is read by editor builds and by agents to decide where a block may legally sit, so omitting the field would not have made the restriction lenient — it would have told every reader there was none, and they would generate placements the write validator then refuses. The bump is required rather than cautious: the entry schema is strict, so a v1 reader rejects an entry carrying the new field outright.

The block library's Insert button now reaches a container's NAMED slot, not only `default`, so a container the drag path accepts is no longer refused by the click path. Documents are migrated when the editor loads them, which is what makes any block's `migrate` reachable at all — and migration only ever moves a document forward, never stamping an older definition version onto data written by a newer one.

The slot rules are now enforced in the editor's reducer, so paste, keyboard reorder and anything added later cannot write a document the save path refuses — previously only drag-and-drop consulted them. Documents are migrated when the editor loads them, which is what makes any block's `migrate` reachable at all.

Fixes a crash opening an Image's aspect-ratio control: Radix refuses a select item whose value is the empty string.
