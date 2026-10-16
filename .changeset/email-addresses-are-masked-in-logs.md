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
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
"nextly": patch
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
---

Outside development and test, Nextly no longer writes a full email address to
the logs. Masking applies whenever `NODE_ENV` is not `development` or `test`,
an unset `NODE_ENV` included, and keeps an address's first character and
domain: `john@example.com` is logged as `j***@example.com`.

- **The log transport**, used when no email provider is configured, wrote
  every recipient, the sender, cc, bcc and reply-to in full on every send in
  production. It now masks each of them and any address in the subject. It
  writes the message body only in development and test; before, an unset
  `NODE_ENV` wrote the body too, reset and verification tokens included.
- **A failed send** logs its provider's error and cause so the diagnostic is
  kept; an SMTP or API error that quotes the recipient now has that address
  masked.
- **Nextly's structured logger** (`getNextlyLogger`) masks every payload
  before it reaches the logger, the default one or one installed with
  `setNextlyLogger`.
- **`consoleLogger`**, the logger services fall back to and a public export,
  masks addresses in its messages and fields too.
- **The dev auto-login warning**, printed when `devAutoLogin` is set in
  production, no longer includes the configured email.

To find a message in production logs, search by the address's domain and
first character instead of the full address. No configuration, API or schema
changes.
