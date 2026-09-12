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

A component can no longer be saved into a shape where the library references
itself.

Components may place other components, so the library is a directed graph. A
loop in it is not a crash — the renderer detects one and draws what it reached —
but it leaves a gap where the loop closes, on every page placing anything on the
loop, and nothing said how it got there. The editor already withheld the tiles
that would close one, but that is a snapshot: two authors saving at once, or one
saving against a library read that had gone stale, closed a loop anyway.

The write now refuses, naming the chain to break — `Hero → Banner → Hero` —
rather than leaving the author to find which placement did it. The check reads
each referenced component as it currently stands, in both its published and its
unpublished form, and refuses rather than guessing when it cannot read them all.

It is deliberately a refusal rather than a warning: the author who closes a loop
is not the person who sees the gap, so a notice would go to someone who has no
reason to act on it.
