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

A site's builder pages can now be served from the cache with previews still working. `createPublicContentPage` and `createPublicBlocksPage` (`@nextlyhq/blocks-react/next`), and `createPublicContentRoute` beneath them (`nextly/runtime`), accept `draft: previewDraftGate()`: the gate is asked only when a preview link has turned on Next.js's draft mode, which Next.js renders on demand and never caches, so every other visitor gets the published page from the cache and publishing refreshes it. A public route still refuses `draft: true`.

The page-builder docs now lead with this cached route. A site on the earlier example, `createContentPage` with `draft: previewDraftGate()`, keeps working unchanged but renders every visit. To serve visitors from the cache, call `createPublicContentPage` with the same options and export its `generateStaticParams` (returning one not-found path while nothing is published, since Next.js refuses an empty list with Cache Components on). Previews keep working at the same addresses.
