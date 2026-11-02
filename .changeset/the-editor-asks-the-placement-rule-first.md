---
"nextly": patch
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/plugin-mcp": patch
"@nextlyhq/ui": patch
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/plugin-form-builder": patch
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

Page builder: the editor asks the placement rule before it acts. A keyboard move, a canvas drop and the Add panel are judged by the same rule as a save, so a refused placement is explained where the author tried it ("Heading can't hold blocks."), and a component placement's exposed slots become drop targets.

`DropRefusal.reason` (an `@experimental` export of `@nextlyhq/builder`) now also carries the placement rule's reasons: `"undeclared-slot"`, `"holds-no-blocks"`, `"phrasing-only"` and `"content-model"`, beside `"wrong-parent"`, `"restricted-at-root"` and `"not-allowed-in-slot"`. A `switch` over it needs a `default`, or a case for each new reason; the refusal's `verdict` carries the facts each one is explained by.
