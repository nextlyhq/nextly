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

The admin loads again for a signed-in user. Removing the refresh cookie from
the request handed to auth hooks, strategies and plugin routes copied the
request with the global `Request` constructor, which cannot read the instance
Next.js passes in, so every session check from a browser holding the refresh
cookie failed with a server error. The copy is now built from the request's
URL, method, headers and body.

A plugin route declaring a method outside `GET`, `POST`, `PATCH`, `PUT` and
`DELETE`, such as a JavaScript plugin's lowercase `"post"`, is now refused when
routes are collected at boot, instead of being registered where no request
could reach it.
