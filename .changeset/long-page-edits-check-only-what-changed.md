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
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
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
"create-nextly-app": patch
"nextly": patch
---

Editing a long page in the builder is faster. Checking an edit against the document's size and node limits no longer measures the whole page: the engine keeps the measured size, node count and depth of every part of a document, and an edit shares every part it did not change, so only the path to the edit is measured. On a 150-block page the check takes about as long as on a 4-block page. The deep check for values a database cannot store still runs wherever a document is saved, written through the API or imported.

An edit that would take a page over its size limit is refused in the builder with the same words a save gives: "Document exceeds the maximum of N bytes." `@nextlyhq/blocks-engine` exports `documentWork()` (experimental), which counts whole-document safety walks and freshly measured parts so a caller can show what an action cost. The tree helpers now return an unchanged node or child list as itself rather than a copy. A document handed to `applyOp` must be treated as immutable afterwards, as it already had to be: the sizes the cap check relies on are kept against each part, so a part changed in place is judged as it was first measured. `countNodes` and `treeDepth` still measure the forest they are given every time.
