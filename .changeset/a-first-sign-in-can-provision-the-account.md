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

A first sign-in can provision the account. When an unlinked identity arrives through a provider key whose own policy — read from the app's auth configuration, never from the plugin's hand-off — allows provisioning, the service creates the account through the one creation primitive that owns every creation refusal: active, verified at the address the provider proved, without a password, with exactly the roles the configuration names for that key. The role names are resolved by slug before any account is made; an empty set, or a name no role carries, refuses the provisioning naming the role and writes nothing, and the highest privilege stays out of reach however the configuration spells it. The account made, the identity is attached to it, so the next sign-in resolves as a linked one — which needs neither trust nor provision, and never re-provisions. A key that may not provision, trusted for implicit linking or not, still provisions nothing: an unlinked identity through it resolves no account, and nothing is written.
