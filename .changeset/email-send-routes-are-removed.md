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

**Breaking:** `POST /admin/api/email/send` and
`POST /admin/api/email/send-with-template` are removed, with their package
exports `nextly/api/email-send` and `nextly/api/email-send-template`. Any
signed-in user or API key could call them and choose the recipient, so anyone
with access could send email as the site.

To send email, call `nextly.email.send()` or `nextly.email.sendWithTemplate()`
from server code. To send from a browser or another service, add a route of your
own that checks who may send, and to whom, before it calls them.

The admin's **Send test** on an email template keeps working. It now sends the
saved template only to the signed-in user's own address, and it has no recipient
field. It needs the `update-email-templates` permission and refuses API keys.
