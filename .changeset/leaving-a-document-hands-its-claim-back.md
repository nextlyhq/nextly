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

Leaving a document now hands its edit claim back at once. Closing the tab, reloading it or following a link out of the admin releases the claim, so a colleague waiting on the document can edit it within a few seconds rather than after the claim's lease runs out.

The lock's messages always name whoever holds the document: a person by their name, else their email; an API key as one ("Ana's API key", or "An API key" when its maker has no name); otherwise "Someone". They never read "null". When a person opens a document they are editing in another tab, the first tab says so and offers "Continue editing here", with its unsaved changes kept, instead of saying they took it over.

While a document is held elsewhere, the reason shown beside its disabled actions reads "This document is being edited elsewhere", which is true whoever holds it, the same person in another tab included.
