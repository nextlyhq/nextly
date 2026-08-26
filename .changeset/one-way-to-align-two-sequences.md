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

Comparing two versions of a document means comparing two sequences: rich text
is a sequence of blocks, and formatted JSON or code is a sequence of lines.
Both need the same operation — work out which units correspond, which were
added, which were removed, and which are the same unit edited — before anything
can say what changed inside one.

This adds that operation once, as a shared internal step, rather than letting
the rich-text and source comparisons each grow their own. Two implementations
of one question agree on the day they are written and drift silently
afterwards.

Inserting a paragraph now marks only that paragraph added, instead of marking
every paragraph after it as changed. An edited unit is reported as one changed
row rather than as a deletion sitting beside an unrelated addition, so a
word-level comparison can run within it.

Where the two sides are too large to align, it says so rather than returning a
partial result: "I could not compare these" and "these are identical" are
different answers, and a silently truncated comparison reads as a confident
one.

Nothing uses this yet, so no comparison changes shape. The rich-text and
JSON comparisons that build on it follow.
