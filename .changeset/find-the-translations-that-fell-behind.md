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

Find every translation that has fallen behind, in one place.

The translation worklist gains a "Needs review" tab: the languages whose source
was edited after they were written, across every collection, newest first. They
are still translated and still published -- this is a second fact about a live
translation, not a demotion -- so the tab is named for what to do about them
rather than for what was measured.

It also says what it could not check. A collection whose translations table does
not yet record when each language was written cannot answer this question, and a
collection that quietly contributes nothing to a list is indistinguishable from
one with nothing to report. Those are now named on screen, with the one thing
that fixes it: run `nextly migrate`. That is kept separate from the collections a
single request could not cover, because reloading helps there and would only
loop here.
