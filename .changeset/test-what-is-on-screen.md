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

The email workbench's Send test now sends what is on screen, unsaved edits included, through the same render path as a real send, and still only to you. The dialog names the provider that will deliver it, and says when that provider delivers nothing: the log provider a site without an email provider falls back to.

An email kept on its first engine now says which fields keep it there and why, and offers "Read it as Liquid" once those lines are changed and saved. The inbox line above the fields shows the preview text and From as a reader sees them, rendered from the sample data, and the preview of a kept email renders it as it sends.

New routes: `GET /email-templates/{id}/send-test` (where a test would go and who delivers it), `GET /email-templates/{id}/engine` and `PATCH /email-templates/{id}/read-as-liquid`. `PATCH /email-templates/{id}/send-test` takes an optional `draft` of the editor's fields and reports the provider in `delivery`. The draft preview also returns `preheader` and `from`.
