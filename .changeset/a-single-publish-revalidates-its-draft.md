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

Publishing a Single now re-judges the pending change it is about to promote, against the schema and the permissions as they stand at that moment.

A Single's publish folds its held draft into the live row. Both gates ran when the caller's payload arrived, and for a publish that payload is just the new status, so the draft's own content reached the live row having been judged only when it was SAVED. Two things could have changed since. The publisher may not be the author, and a field rule can deny them a value the author was allowed to write. And the schema can have tightened under a value that was legal when it was held.

BEHAVIOUR CHANGE, and it is visible. A draft written under an older, looser schema is now REFUSED at the moment someone hits Publish, having raised no complaint when it was saved. The refusal names each field and carries the rule's own message, so the author can see what to fix. Publishing content that violates the current contract is the worse outcome.

A pending change that edits a field the PUBLISHER may not write is refused too, rather than being quietly dropped from the write. A successful publish consumes the pending change, so dropping the value would have published everything else, deleted the draft, and destroyed the author's edit with it. Refusing keeps the draft intact for someone who can write that field. Only a field whose promoted value actually differs from the live row counts: a draft snapshot is a full copy of the document, so a denied field appears in every one of them.

Both gates run over the snapshot being promoted and never over the live document, so a schema change cannot block someone from fixing and republishing unrelated content. They run over that snapshot in its logical shape, so a Single that merely HAS a group, repeater or JSON field is not refused for holding one.

Both publish paths are covered by one gate: the ordinary publish and `publishAllLocales`, which promotes every language's pending change in its own loop and had no such check at all.
