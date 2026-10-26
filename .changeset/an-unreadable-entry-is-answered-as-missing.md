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

An entry you may not read is answered exactly as one that doesn't exist: 404 `NOT_FOUND`, "Not found.", whatever you asked to do with it. An entry you may read but not change is still answered 403, with what you may not do.

This holds for a request naming one collection entry or a Single's document, through REST, the Direct API, plugin services and the routes built on them, the document lock among them. The Direct API and plugin services used to answer an update, delete or publish of an entry you may not read with 403 when it existed and 404 when it didn't, which told a caller whether an id existed; both now answer 404. Whether you may read is asked as a plain read is, in the site's default language.

One place does not take that answer at its word: a dashboard card reading a Single. A card for a Single you may not read fails instead of showing "Nothing yet". Singles are the site's own configuration, defined in code, so their names are not secret, and an empty card for a refusal would tell the admin something false. A Single that really has no document still shows as empty.

A client that treated a 403 on one entry as "this entry exists" reads the code instead: `NOT_FOUND` for one it may not read, `FORBIDDEN` for one it may read but not change. A caller with no identity keeps its current answer.
