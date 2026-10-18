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

Requests from clients whose address cannot be read are now charged to the identity they name at the time they are admitted, with the shared ceiling still spent when they arrive. On a plugin's `rateLimit: "auth"` route, the body was read after the ceiling but charged at the time the request began, so a caller holding several bodies open longer than the window could make each charge land at a time already expired, and spend an identity's budget more than once. The route now spends the plugin's ceiling on arrival, before its body is read, so the ceiling also bounds how many requests a caller can hold open, and charges the identity once the body is in. Without a shared store, the ceiling place a request spent moves with its charge, so the two still expire together; core's token routes and strategy-keyed sign-ins are charged the same way.

The once-per-process warning about proxy client-address headers that could not be used also now says how a plugin's auth route counts such requests: by the identity its `limitKey` names, or against one budget its requests naming no identity share, under that plugin's own ceiling, or by the ceiling alone without a `limitKey`.
