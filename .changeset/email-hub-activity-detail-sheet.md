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

Each row of the Email hub's Activity list opens a detail sheet. Its state comes first: what happened, why in plain words, and what to do for each kind of failure. Then come its details: the template, which version of it was sent (the owner's default, the site's version, its own template or its code version, or that none was recorded), the provider, and the recipient kind. Last come its attempts with the provider's structured answer, the newest 100 drawn and the rest counted, and a queued email also shows its next attempt and whether its message is still held. When a queued email failed because of its template, Fix template opens that template for a reader who may edit it. On a phone the sheet fills the screen.

The email Activity sheet says only what the record shows. A queued email still retrying after an unknown outcome says not to send it by hand as well. A sheet reads its email afresh each time it opens. Fix template is offered only while the template failure is the email's current state. "No attempt yet" and "Not sent yet" are said only of an email still waiting to be sent; otherwise the sheet says no delivery is on record, or no version was recorded.
