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

The Direct API's reads of users, roles and permissions, media and field groups are checked when the call asks to be.

With `overrideAccess: false`, on the instance or on the call, each read asks the grant REST's route asks for the same read, before it reads anything:

- `users.find`, `users.findOne` and `users.findByID`: `read-users`.
- `roles.find` and `roles.findByID`: `read-roles`; `roles.getPermissions`: `read-roles` or `read-permissions`.
- `permissions.find`: `read-roles`, which the role form needs; `permissions.findByID`: `read-roles` or `read-permissions`.
- `media.find`, `media.findByID` and `media.folders.list`: `read-media`, as the admin's media routes ask.
- `fieldGroups.find` and `fieldGroups.findBySlug`: a named user and no grant, as REST serves field groups to any signed-in caller.

A checked call that names no user is refused as unauthenticated, and a key's scope (`actor`) is judged on its own grants. Inside a request made with an API key, a checked media read that names a person and no key is refused, as a media write is. A read that is refused throws, `disableErrors` included. Trusted calls, the default, are unchanged.
