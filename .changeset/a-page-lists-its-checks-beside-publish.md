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

The builder lists a page's checks beside Publish. A count, "2 checks" or "Checks" with a
tick, opens "Page checks", grouped as Accessibility, Content and data and Publishing
(and Search where a plugin adds checks). Each item says what is wrong, why it matters and
what to do; choosing one selects the block, brings it into view and opens the setting that
fixes it, and a slim "Check 2 of 5" bar then walks the list while the inspector stays
clear. The checks judge the draft on screen, unsaved changes included, and never hold back
Save or Publish. The first check finds an image with an address and no alt text that isn't
marked decorative. The checks are plain functions over a document, `runPageChecks` and
`CORE_PAGE_CHECKS` from `@nextlyhq/builder`, so a script or a route gets the same findings.
