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

A dashboard arrangement now survives a reload.

`nextly_widget_layout` stores one row per reader: which cards, in which order,
at which size, and which they have put away. `GET /api/dashboard/layout` returns
that arrangement resolved against the live registry, and `PUT` replaces it,
guarded by a version so two tabs cannot silently overwrite each other. A reader
who has never arranged anything still sees the registry's own order, so nothing
changes for anybody until they move a card.

The stored row holds an identity and a position and nothing else. It never
copies a widget's `requiredPermission`: every question about whether this reader
may see a card is asked of the live registry on each read, so tightening a
permission takes effect immediately rather than after the reader next saves.
A card they may not see is dropped from the response silently -- and carried
through untouched on the next write, so being unable to see it is not a way to
lose it.

Both guards travel on the wire, and a write must echo both. `version` catches a
second tab that saved first. `scope` catches the other half: the snapshot a
client holds was shaped by which widgets it could see, and a permission grant
moves that without touching the row -- so a card that was hidden at read time
and visible at write time would otherwise be in neither the submission nor the
carried-through set, and the write would delete it with `version` still
matching.
