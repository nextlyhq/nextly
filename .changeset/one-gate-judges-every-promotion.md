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

Publishing a collection entry no longer discards an edit it is not allowed to publish.

A publish folds the held working draft into the live row and then deletes that draft. The field rules ran when the caller's payload arrived, and for a publish that payload is just the status, so the draft's content reached the row having been judged only when it was saved. Where the publisher was not the author and a rule denied them one of the draft's values, that value was stripped: the rest was published, the pending change was consumed, and the author's edit was gone with no error and nothing left to recover it from.

The promotion is refused instead, naming each field at its own path, including a field nested inside a group, and the pending change is kept for someone who can write it. Stripping stays the right answer on an ordinary write, where the value is the caller's own input and dropping it costs them nothing they did not already have. Only a value the write would CHANGE refuses it, so a denied field sitting at the value it already holds publishes as it always did.

The same question is now answered in one place for every publish path. A Single's publish, `publishAllLocales` and a collection's publish each assemble the document they are about to write in their own way, since a collection's also carries components and many-to-many rows, and then hand it to one shared judge.

A collection field rule is judged on the caller's own authority. An API key carries the grants stamped on the key, and the write paths did not pass them to the field rules, so a rule reading `permissions` was answered from the database roles of whoever owns the key. A correctly scoped key could not write a field it holds the grant for: the value was dropped in silence and the call still reported success.

The caller's permissions are resolved before the publish transaction opens. The promotion gate runs under the row lock, because a check that runs before the write can disagree with the write, and a permission lookup first issued from in there waits on the pooled connection the transaction is holding: against a small pool the publish hung rather than failed.

Only the pending change's own values are refused. A value the caller sends with the publish is stripped as it is on any other write, because it is their own input and dropping it costs them nothing they did not already have. The two are told apart because a rule reads its siblings: a caller's value can be allowed when their payload is judged alone and denied once the pending change is folded in, and refusing there would block a publish over the caller's own edit.

An untouched field is not read as an edit because of how it was stored. A pending change is JSON, so a timestamp reaches the comparison as the ISO string it was serialised to while the live row comes back from the driver as a `Date`; compared as they arrive, every date-bearing field the publisher may not write refused a publish that changed nothing.
