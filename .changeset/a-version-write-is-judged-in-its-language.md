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

A restore of a version and a take of the live values into a held edit are judged by the update rule in the language they write, as an update in that language is. A rule that refuses one language, such as `update: ({ locale }) => locale !== "de"`, now refuses a restore of a German version and a take of the live values into a German held edit; before, both went through, because the route judged them in every language and the write did not ask the rule again. A rule that allows only one language, such as `locale === "de"`, now allows a restore of a German version and a take of the live values into a German held edit, which it refused before. A rule whose filter is answered by language is matched in the written language: a restore or take that matches the German filter succeeds, and one that does not is refused. This holds for a collection entry and a Single.
