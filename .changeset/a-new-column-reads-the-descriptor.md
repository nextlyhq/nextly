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
"@nextlyhq/plugin-mcp": patch
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

A field added to a collection now becomes the same column it would have become
when the table was created.

Three implementations answered "what column is this field?", and the one the
product READS through — the canonical descriptor, used by the runtime Drizzle
table and by the schema diff — was not the one the Schema Builder wrote with.
So the table a user got was not the table the rest of the system believed it
had, and the failure surfaced far from its cause: a diff proposing the same
change on every run, or a write rejected by a column whose type nobody
declared.

Both paths that CREATE a column now read the descriptor. The path that alters
an existing column deliberately does not, and that boundary is the whole safety
argument: restating a live column under a mapping it was not built with is a
narrowing `MODIFY` on MySQL that truncates stored values for an edit that
touched nothing but a flag. No existing table is altered by this change.

Two of the fixed disagreements were losing data outright on a column added to a
table that already existed:

- A number field set to `float` was added as a whole-number column on all three
  databases, silently discarding every fraction written to it. It is now
  `float8` / `double` / `real`, which is what the same field gets when its table
  is created.
- A text field declared short was added unbounded on PostgreSQL and MySQL,
  losing the width the field asked for.

Both happened because the ADD COLUMN path rendered a column from the field's
type and length alone and never saw its options or validation.

One family of disagreements is deliberately NOT converged here. The descriptor
stores a field holding many values (`hasMany` numbers, uploads, relationships)
and a repeater or group as a JSON array where these generators emit a scalar.
That changes the column's storage class rather than its spelling, and the type
is not the only thing that would have to move with it: indexability is decided
from the old rendering, a relationship attaches a scalar foreign key, validation
bounds are emitted as a comparison against the column, and a required column's
backfill derives a scalar default from the declared type. Taking the
descriptor's type alone would emit `CREATE INDEX` on a JSON column, a foreign
key from an array to a scalar id, and `json NOT NULL DEFAULT 0`. Those stay
recorded as known disagreements until the consumers move in one change.

Some column types are spelled differently as a result — `int4` for `integer`
and `bool` for `boolean` on PostgreSQL, `tinyint(1)` for `boolean` on MySQL.
These are the same types under the names the descriptor and the database's own
catalog use, not storage changes.

One consequence worth stating plainly: on MySQL a `select` or `radio` column
created from now on is `varchar(255)` where it used to be unbounded `text`,
because that is what the descriptor says. Nothing existing is affected and
nothing can be truncated, since only columns that do not yet exist are rendered
this way. Whether the descriptor should instead move to `text` for these types
is a separate open question.

The conformance matrix that pins these three implementations against each other
lost 23 accepted disagreements, all of them on the collection generator's
create and add-column paths. Its ratchet is checked in both directions, so an
entry describing a disagreement that no longer happens fails the suite — the
list could not have been left stale.
