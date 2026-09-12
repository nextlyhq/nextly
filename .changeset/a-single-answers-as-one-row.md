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
and `collections:present` conditions now answer from the registries' own
readable listing -- what the management cards they gate list -- so a
collection or single whose migration is still pending keeps its card on the
dashboard instead of disappearing exactly when it needs attention. A single
whose DDL a reload refused is withheld from the widget sources the way a
collection's is, from one shared store of deferred entities.

A Single's not-found answer now says which Single it is about: the error's
`data` carries `{ single: <slug> }`, the slug the caller named. A draft-only
Single and a nonexistent one still answer identically.

A single's widget query projects OWN properties, so a field the read removed
for a caller -- one named `toString` or `constructor`, which a single may
legally declare -- stays removed instead of answering with the value
`Object.prototype` carries.

A collection or single whose metadata sync could not store its new field list
is withheld from the widget sources for the rest of the process, beside the
ones whose DDL a reload refused: in both cases the registry's description and
the table are known to disagree, and a card drawn from one queries a shape the
database does not have.

A single the boot cannot register -- because a collection already holds its
slug, say -- now fails the boot naming it, as a collection in the same state
already did, instead of leaving the app running without a single its config
declares.

A collection, single or field group can no longer take a slug another kind
already holds. Slugs are one namespace across kinds -- as
`defineConfig` already enforced for an app's own config -- and before, such a
boot succeeded while the registry silently refused one of the two at sync, so
an app's single could vanish behind a plugin's collection of the same slug.
The boot now fails with `NEXTLY_SCHEMA_SLUG_COLLISION`, naming both owners in
the log. The same rule is applied to the entities the Schema Builder owns,
once the registry is readable -- at the runtime boot and on the CLI -- so a
Builder single and a plugin collection under one slug are refused up front
rather than at registration, where one of the two was rejected by a message
naming neither the other kind nor its owner.

Under `next dev`, a single whose fields you edit keeps its source and its
status card: the reload re-marks an edited single's migration as applied from
the sync's own report, as it already did for an edited collection, instead of
leaving the row `pending` for the rest of the session.
