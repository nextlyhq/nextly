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

Settings → Site has an Advanced section with the site's CSS variable prefix. It shows `--site-` unless changed, says that the site's own CSS using the old names must change too, and asks before a change. `--nx-`, `--tw-` and anything that isn't a prefix are refused with a plain reason. Once changed, the canvas and published pages are written under the new prefix at once and look the same, and each variable's "Code name" in Design reads it.

The question before a change counts the shadows that name a colour variable through the old prefix, since those lose that colour until it is picked again. A prefix the site's code sets is shown, and a prefix saved here replaces it.

The prefix is changed only through the new `/site/css-prefix` route, under the site settings permission. The site style Single refuses any other signed-in write that changes it, as it does for breakpoints. The engine's `resolveTokenPrefix` now gives a plain `refusal` reason, and `safeTokenPrefix` names the reserved prefix it refused.
