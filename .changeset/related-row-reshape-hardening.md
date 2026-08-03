---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
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
---

Harden nested field-level read access against `afterRead` hooks that reshape a
read response. A related row's presentation is its own collection's authority, so
the response's related rows are now rebuilt from the versions the read sanitized
rather than inspected for tampering: whatever a source collection's `afterRead`
hook did to a related row — reintroducing a denied field, cloning or reshaping the
row, replacing, appending, reordering or removing its nested group/repeater rows,
or returning a rebuilt document — is discarded. The rebuild runs after every hook
phase, so one phase cannot hand the next a contaminated related row to copy from.

Closes a field-hook exfiltration path on related rows. A field hook belongs to one
field but is handed the whole row, so a hook on an ALLOWED field of a related row
could read a DENIED field beside it and return it as its own value — and the access
pass that ran afterwards, judging each field by its own rule, had no reason to remove
the copy. The target collection's field access now runs BEFORE its field hooks and
again after, the same order a direct read of that collection uses: a row reached
through a relationship may be redacted more strictly than the target's own endpoint,
never more loosely.

Also fixes a related-row read-access gap for a relationship that declares a single
target as an ARRAY (`relationTo: ["posts"]`). That form stores and expands as the
discriminated `{ relationTo, value }` pair, but the nested read decided the pair
shape from the NUMBER of declared targets and so treated the wrapper as the row
itself — evaluating the target collection's field `access.read` rules against an
object holding only `relationTo` and `value`, which matches nothing. A field the
target collection denies was returned inside the wrapper. The shape is now read
from how the target was declared, in one place shared by every reader.

This also removes the previous release's over-stripping: a related row a hook
merely copied is no longer returned with its access-controlled fields denied, it
is returned correctly sanitized, and the development-mode warning about reshaped
rows is gone. A denied source field stays hidden from the source collection's own
field hooks so it cannot be copied onto a selected field.

Notes for hook authors. A source collection's `afterRead` hook can no longer change
how a related row appears in the response, including its readable fields: transform
the related collection's own fields with that collection's field hooks instead.
Filtering or reordering a `hasMany` relationship still works, since that shapes the
source field rather than the related rows. A populated related row a hook invents
(one the read never expanded, so no collection's read rules were ever applied to it)
is returned as the bare reference it names rather than as an object.
