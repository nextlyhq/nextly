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

The class-usage index now finds the blocks fields it is responsible for by reading a
collection's LIVE configuration, so a collection created after the plugin was wired - or a
blocks field added to an existing one - is tracked rather than missed.

A blocks field inside a PRESENTATIONAL group is found. A group without a name stores nothing
of its own and its children live at the parent path, so such a field is reached the same way
a top-level one is; skipping it would leave that document's classes out of the index
entirely, and a class the page still renders would then read as unused. A NAMED group and a
repeater stay excluded, because their children are reachable only through a path the rebuild
cannot resolve - indexing those would write rows nothing could ever reconcile or sweep.

A group whose name is the EMPTY STRING is presentational too. That is what a host writes for
a layout group it gave no key, and core resolves references and redacts paths through such a
group at the parent level - so one definition of "has a name" now answers both questions this
filter asks, and a group cannot be read as named while the blocks field inside it is read as
unaddressable.

A group that contains itself no longer hides its siblings. Expansion is tracked by identity,
so a cyclic group is descended into once; a bound alone ended the walk without ever reaching
the fields declared after the cycle, and an empty result is indistinguishable from a
collection that declares no blocks field - every class the document applies would have read
as unused.

A group with a very long field list is read without failing. The walk holds a cursor into each
list where it lies rather than moving children into a queue: moving them passes each one as an
argument, which reaches the engine's limit at around a hundred thousand and throws before the
visit bound can apply. Maintenance runs after the document has committed, so a throw there
reports a failed save for one that succeeded.

Whether a field stores per language is decided by the collection's localization master switch
together with the field's own flag, through the same classifier storage obeys. A field flagged
localized on a collection that stores no translations is held ONCE, under the empty locale
key; reading the flag alone enumerated a subject per configured language and left the single
subject a read resolves to holding no rows at all. The filter therefore takes the collection
rather than its field list, because pairing one collection's fields with another's switch
would produce subjects under locales that collection never stores.

Configuration is read defensively, because it arrives as whatever the host wrote, including
from untyped JavaScript and the Schema Builder's stored JSON. The localized flag and the
master switch are both read as strict booleans, so a stored string does not file one
document's classes under every language. A field with no usable name is skipped rather than
defaulted, since the name is the column every row is keyed by. A duplicate name yields one
subject rather than two.
