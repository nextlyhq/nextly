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
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
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

A page builder document is now judged as a reader receives it, on every write
path — the editor, the API, a batch, and an import that skips hooks:

- a component save that would make the component contain itself is refused,
  naming the chain;
- a document whose components put a block where the nesting rules forbid, or
  nest deeper than the depth limit counted from the top of the document, is
  refused, naming the placement;
- a component change that would break a page, Layout or component placing it
  is refused, saying how many documents it would break and which rule. The
  documents themselves are named only in the server log, since they were found
  and read as the system. Documents the usage index cannot vouch for are
  reported in the server log as unjudged.

Plugin field types gain an experimental `write` argument on `validate`: which
entry the write is for, and `readStored`, a read of stored values of the
validator's own type on the write's own connection — so a batch's own rows are
seen. The page builder's former cycle-guard `beforeChange` hook is removed;
bulk component writes with hooks running are no longer refused for being in a
transaction.
