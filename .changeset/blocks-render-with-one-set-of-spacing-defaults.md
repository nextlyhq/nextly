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

Every block now renders with one set of spacing defaults. Headings and paragraphs carry no outer margin, and the space between blocks is the gap of the container holding them, in rows as well as stacks. A site whose stored style still names the classic spacing model renders the same as any other site: the old heading and paragraph margins, the Divider and Quote margins, the unpadded Sections and Cards, the smaller Button padding and the missing container gaps are gone, and every stored page stylesheet is recompiled once, the next time it is served, so none drawn under classic is served again.

`@nextlyhq/blocks-react` no longer reads or passes a spacing model. `spacingMode` is removed from a block's render arguments, from the props of `RichText`, `BlockBoundary` and `BlockList`, and from what `sharedStyleInputs` returns, and a `spacingMode` stated on the style compile context handed to `PageRenderer` or `resolvePageStyles` is ignored. A custom block that read it, or a caller that passed it, should drop it; the markup and stylesheet are the ones every site now gets.
