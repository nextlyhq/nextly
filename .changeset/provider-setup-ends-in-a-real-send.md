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

Adding an email provider in the admin is now three steps: choose its type, connect it with only that type's settings, and send a real test. Where a provider can be asked without sending (an SMTP sign-in, a Resend key), its settings are checked before they are saved. A new provider is saved off and is never the default until its test is accepted or someone turns it on, and only a provider that is on can be made the default (an existing default is left as it is). A failed check or test is explained by what to check: the sign-in, the sender or its domain, the recipient, a rate limit, the connection, or something else. An accepted test is reported as accepted, not delivered, and a test through the Log provider as logged. **Send a test** works from every provider's row and page, and replaces the old disabled Test Connection button. The Sending tab shows the default sender, a provider set in code, and a warning when the Log provider is the default outside development; a provider's page shows its sending domain's status where the provider reports one (Resend does). A provider whose type is off can now be tested. A provider test email now goes to your own address: the address in the request is ignored, and an API key, which has no address of its own, is refused. New routes: `POST /api/email-providers/check` and `GET /api/email-providers/settings`; `GET /api/email-providers/[id]` adds `domainStatus`. Provider definitions may declare `domainStatus`, and a `testConnection` result may carry `setup`; the `detail` a probe returns is now logged with the provider's declared credentials redacted, as a thrown failure already was. Send results are unchanged.
