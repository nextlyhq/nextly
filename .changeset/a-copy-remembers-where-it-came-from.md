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

A copied subtree can record where it came from, so "the thing this came from has
changed — do you want the change?" becomes answerable later.

`BlockNode.origin` is inert: no renderer reads it, no validator requires it, and
a document without one is complete. It exists to be read later by a surface
asking whether an upstream source has moved on — the question every mature
builder's users ask and none of them answer, because an unsynced copy keeps no
record of its source. It cannot be added retroactively: a page built before the
field exists can never be told where its blocks came from, which is why it lands
while the format is still pre-alpha rather than when the feature that reads it
is built.

ONE field with a discriminant, rather than one field per source. A pattern copy
and a detached component are two provenances today and there will be more — an
imported document, a duplicated page — and each as its own key is a stored
format that grows a column per feature. The discriminant also lets the arms
differ honestly: a pattern copy carries a digest of what it copied, because the
pattern can change underneath it; a detached component carries none, because
detaching is the act of declining further change.

The digest is of CONTENT rather than a version number. The engine is handed a
document and not an entry row, so it can hash what it was given and cannot see
what the store calls it — and content answers the question more precisely
anyway, since a re-save that changed nothing bumps a version and leaves a digest
alone.

A half-formed record is refused rather than stored. A pattern origin with no
digest, an empty id, or a source nobody declared would be written and then read
by a surface that trusts it, so the op layer checks the shape the way it checks
every other node field. The record is also removable by an ordinary update:
provenance is a record and not a lock, and a field an update can never address
is one that can only be removed by deleting the node it sits on.

The stored format gains an optional field and nothing else. Old documents remain
valid, and documents carrying the new field are readable by older code — the
node schema already admits properties it does not know, and an unknown node
field is measured to survive an op round trip unchanged. So `formatVersion` does
not move.

The provenance type is reachable from every entry point that publishes the field
that names it. A package that exports `BlockNode` and not the union one of its
fields holds leaves a consumer able to read the value and unable to write its
type, which is the coupling those entry points exist to avoid — and the
renderer package already had a guard saying so, which caught it.

The import scanner behind the format entry's boundary test no longer reads an
import out of ordinary code. A module specifier cannot contain a newline, and
without that constraint the literal `"from"` matched the keyword pattern — the
string's closing quote read as a specifier's opening one, capturing the next two
lines and reporting them as an external dependency. Any code holding that string
would have tripped it.
