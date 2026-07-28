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

Updating a Single no longer returns related fields the writer is not allowed to read.

The response expands relationships, and those rows belong to another collection carrying its own field-level `access.read` rules. Read paths have evaluated them since the field-access work landed; this path forwarded no caller, so it returned every related field intact — including ones the same caller's `GET` would withhold. That made the write path a way around the rule: write anything, read the response back.

A writer supplied a relationship id, not the related row's protected fields, so "they supplied the data" does not cover them. The rule that applies is the target collection's own, and it is now evaluated against the caller that made the write.

This reaches every hop the response expands, not only the first: a related row's own relationships carry the rules of the collection at the far end, and those are evaluated too.

Every caller the access gate applies to is judged, including one with no identity — an anonymous write permitted by a public update rule gets the same answer its read would give. Only a trusted write bypasses this, through `overrideAccess` rather than through an absent user.

One consequence worth knowing if you write `afterUpdate` hooks: they receive the response as the caller will see it, so a related field that caller may not read is already gone. That matches how reads behave — related-row rules are applied while relationships expand, before `afterRead` hooks run — and it is why the two paths now agree. The Single's own fields are still redacted after your hooks, unchanged.
