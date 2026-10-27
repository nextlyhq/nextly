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

A publish that only sends back what the draft already holds is no longer credited as the publisher's edit in Recently edited.

The draft and the document the publish writes are now compared once, as a stored snapshot holds them. So none of these counts as a change:

- a date sent as a `Date` beside the ISO string the draft keeps;
- part of a component sent back as the draft holds it;
- many-to-many ids in another order.

A Single's own field named `createdBy` counts as content, as it does for any field a person writes.

Two dashboard fixes:

- A Note's text is drawn as written, so a leading indent keeps its Markdown meaning.
- A layout write holds a placement id reused for another widget to the new widget's text bound.
