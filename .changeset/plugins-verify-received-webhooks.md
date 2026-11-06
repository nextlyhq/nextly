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

A plugin can verify the webhooks it receives with `ctx.security.webhooks.verify(request, { scheme, secrets })`: in Standard Webhooks (`standardWebhooks`, the scheme Nextly signs its own webhooks with) or in a provider's own scheme the plugin describes. Core refuses a delivery signed more than 5 minutes away from now (`toleranceSeconds` changes it, finite only), compares every signature with every secret in constant time so a rotation verifies with both secrets, and refuses a body over 1 MiB (`maxBytes`). A scheme with no timestamp must say `timestamp: "none"`, and its verified result says `freshness: "unchecked"`. The answer is `{ verified: true, body, … }` or `{ verified: false, reason }`; nothing is verified by default. Experimental.
