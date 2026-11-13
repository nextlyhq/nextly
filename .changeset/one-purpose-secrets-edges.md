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

Fixes to plugin one-purpose secrets (`ctx.security.secrets`) and plugin names:

- A secret's expiry is held to the whole second on every database. Before, SQLite and MySQL stored whole seconds while the mint returned milliseconds, so a secret could expire up to a second before the `expiresAt` it was given.
- A subject's 255-character bound counts characters, so a subject of emoji fits up to 255.
- With no `NEXTLY_SECRET` set but retired secrets still listed in `NEXTLY_SECRET_PREVIOUS` (allowed outside production), new secrets are written with the unkeyed generation, not the first retired key. Clearing the retired setting later no longer strands them.
- `definePlugin` refuses a plugin name that isn't well-formed Unicode. Two names differing only in lone surrogates would otherwise key the plugin's stored values alike.
