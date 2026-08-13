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

Retention now keeps what you asked it to keep.

Setting a retention window to `Infinity` — the strongest way the type allows you
to say "keep these forever" — was deleting instead. Audit trails were removed
after 90 days and webhook events after 30, on the schedule the default sets,
while the setting itself read as accepted. Nothing surfaced it: the pass ran,
reported success, and pruned rows the configuration had asked to retain.

The cause was two separate answers to one question. Audit and webhook retention
each resolved a configured window in their own file, and the two had drifted: a
2000-year window kept everything, an infinite one deleted, and the same input
produced different outcomes depending on which trail it was written for. Webhook
retention also had no upper bound at all, so a very large window produced a
cutoff date no database column can store, which made the pass fail silently on
every run and leave the ledger unpruned.

There is now one resolver behind both, built on the rule they disagreed about:
refusing a value must never delete more than accepting it would. An infinite
window, and any window longer than a date can express, now mean keep forever.
Values that ask for less than the default, or for nothing coherent, still fall
back to the default, because that direction cannot lose data.

Two positions each trail holds on its own are unchanged: `false` still means
keep forever everywhere, and a delivery ledger set to zero still keeps nothing,
which is a real choice for a table whose only purpose is making a retry
possible.
