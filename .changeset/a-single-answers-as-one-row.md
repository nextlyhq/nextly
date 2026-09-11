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

A `single:<slug>` widget source is executable.

`WIDGET_SOURCE_KINDS` named the kind and nothing published or ran it: a widget
query over a single was refused as "not executable yet". Every single the
install has is now published as a source beside the collections, from the
singles registry at request time, and a `list` query over it reads the one
document through the same access-controlled read as the API -- the single's
own rules, code-defined ones included, decide the answer -- and returns it as
a list of one row projected to the selection. A single answers a fixed
question, so `list` is the one op it supports: a `where`, a `sort`, a `count`
or a bucketing over it is refused by name rather than answered.

The dashboard offers one status card per single a reader may read -- whether
it is published, and when it last changed, linking to the single -- the way it
offers cards per collection: never placed, only offered. The `singles:present`
condition now reads the same source registry the collections condition does,
so the two halves derive from one place. A single whose DDL a reload refused
is withheld from the sources the way a collection's is, from one shared store
of deferred entities.

Under `next dev`, a single whose fields you edit keeps its source and its
status card: the reload re-marks an edited single's migration as applied from
the sync's own report, as it already did for an edited collection, instead of
leaving the row `pending` for the rest of the session.
