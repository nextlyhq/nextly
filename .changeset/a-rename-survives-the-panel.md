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
"@nextlyhq/plugin-mcp": patch
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

A rename of a site class survives the panel it was started from.

The class manager lives in a rail that unmounts it on every switch, and that
switch is exactly what makes two renames of one class overlap: the author
renames, moves away, comes back, renames again, and the first write is still on
the network. Two things were decided from state that the unmount destroyed or
that the wrong attempt cleared.

The name a class is HEADING FOR is now released only by the rename that is still
the live one. An earlier attempt finishing under a later one used to release it
for both — and the panel then judges the next edit against the name on screen
rather than the one being written, so typing the original back reads as "nothing
changed" and is silently dropped while the later rename goes on to persist a
different name.

And whether an answer still describes the rename being attempted is now decided
from an identity the HOST owns. Kept inside the field, it was destroyed by the
unmount and started again from zero, so the first answer to arrive after a switch
passed as the current one: a refusal for a rename the author had already replaced
was raised from the shell, naming an edit that no longer existed.

Both decisions now read the same identity, because they are the same question
asked twice.
