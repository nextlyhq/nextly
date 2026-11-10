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

Each person can store their own interface language, the language they want the admin in, through their own profile: `PATCH /admin/api/me` or `updateMe` take `interfaceLanguage` (a language tag such as `fr` or `pt-BR`, or `null` to follow the browser), and `GET /admin/api/me` returns it. It is kept in a new nullable `interface_language` column on `users`, which `nextly migrate` adds to an existing install without rewriting a row. An administrator's `PATCH /admin/api/users/:id` or `users.update` naming it is refused, naming the field.



**Compatibility:** `interfaceLanguage` is now a reserved user field name. An app that defines a custom user field with exactly that name is refused at startup and must rename it.
