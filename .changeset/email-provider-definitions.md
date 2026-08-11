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
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
---

Email providers are now described by a definition, so a plugin can add one that works everywhere a built-in does.

A contributed provider could previously be registered but never configured: the REST API and the provider service both validated the type against a fixed list of the three built-ins, and `defineConfig` resolved providers through a hardcoded switch. Registration is now the only thing that decides which types exist.

A provider definition also declares its configuration fields, which values are secret, and how to validate them. Secrets are redacted because the provider says so rather than because a key name looked sensitive, and an invalid configuration is rejected when it is saved instead of when a send later fails.
