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

Publishing several languages at once asks the publish rule once for each
language it puts live.

Publishing every language of an entry or a Single, and writing
`status: "published"` with `locale: "*"`, used to ask the publish rule once,
told every language and no single one. A rule answering by language, such as
`publish: ({ locale }) => locale !== "fr"`, was then asked with no `locale`
and let French go live. Each of them now asks the rule once for each language
going live, with `locale` set to that language and `locales` to every
language going live, inside the publish, before anything is written. Any
refusal refuses the whole publish, so no language goes live; the server log
names the languages refused.

Unpublishing every language is still asked once, in every language.
