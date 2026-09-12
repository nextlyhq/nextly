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
"@nextlyhq/plugin-mcp": patch
---

The promote gate judges the draft the write actually commits.

The gate that re-judges a Single's pending change before it is published ran before the write transaction, where it could only judge a copy of the world as it was. It now runs inside that transaction, on the draft the transaction has locked, which closes what a pre-flight check could not: a draft saved by another writer between the check and the commit is now the draft that is judged; a `beforeChange` hook that turns a status-less edit into a publish no longer slips past a check that ran before the hooks; and `publishAllLocales`, which applies every language's snapshot to one row, now judges the combined result rather than each language against its own shared values. Resolving the caller's grants is the one thing that cannot happen inside a transaction, since it queries the pooled connection that transaction holds, so it is resolved beforehand and handed in.

A field rule on a child of a group or a repeater row is enforced. The check copied the snapshot shallowly, so the rules deleted a denied nested value from the copy and the original alike and the comparison then saw an unchanged container. A denied child is now found at its own depth and named at its own path.

A publish is no longer refused over a field nobody touched. The comparison read the live document through a read that expands an upload or a relationship into the document behind it, while the snapshot holds the identifier, so an untouched field of either kind looked like an edit. Both sides now go through one conversion.

A draft older than a newly required field is refused rather than published. The check judged the promoted document as a patch, which skips absent properties by design, so a snapshot written before a field became required reported nothing and published a document that violates the contract.

An API key is judged on the grants stamped on the key, not on the database roles of whoever owns it.
