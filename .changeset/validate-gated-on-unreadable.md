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

A document the size survey could not READ is no longer read anyway.

`surveyDocument` refuses to invoke an accessor — it reports the document
`document-unreadable` rather than run a getter it was handed — and the node walk
then reached those same fields by ordinary property access, invoking exactly
what the survey had declined to. Ten node fields did it: `id`, `type`,
`version`, `props`, `slots`, `attributes`, `cssId`, `styles`, `bindings` and
`visibility`, each taking a caller's error out of `validate()` as a native throw
instead of the issue list it promises.

This is the root of a class that produced roughly twenty-three of thirty review
findings across three pull requests — a value read before it has been
established as data — and two of those findings were introduced by a fix for
another. Guarding each read is what kept failing; the verdict was already
computed and simply never consulted.

**A document that merely exceeds a limit is unaffected.** Only `unreadable`
stops the walk. An oversized document was read perfectly well, its nodes are
still checked under the cap, and every per-node issue it produced before is
still produced.

**The trade, stated plainly:** an unreadable document now reports one verdict
rather than several. A duplicate DOM id inside one is no longer named
separately. Those documents come from an import or a script rather than from the
editor, and the same duplicate on an ordinary document is reported exactly as
before.
