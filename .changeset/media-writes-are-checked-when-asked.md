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

Media writes are checked when the caller asks to be checked.

A Direct API `media` write (`upload`, `update`, `delete`, `bulkDelete`, `folders.create`) made by an instance or a call with `overrideAccess: false` now needs `create-media`, `update-media` or `delete-media`, the permission the REST media routes ask, and a checked call that names no user is refused as unauthenticated. Trusted writes are unchanged, except that a write now records an instance-level `user` as a folder's creator and a file's uploader. A trusted `media.folders.create` that names no user still fails, as before, because a folder's creator must be a user.

`ctx.services.media` writes take `ServiceOpts` where they took a `RequestContext`, as `ctx.services.collections` does. A write made as a person (`{ user }` or `{ as: "user", user }`) is judged as REST judges that person, `{ as: "public" }` is refused as unauthenticated, and no options or `{ as: "system" }` stays trusted. A checked write records its caller as the actor and refuses an `actor` naming someone else.

Passing a `RequestContext` to a `ctx.services.media` write is deprecated. It is still accepted and read as `ServiceOpts`: its `user` is now checked as that user, and its `role` and `permissions` are ignored, because a person's roles are read from their account.

On every plugin service, `{ as: "system", user }` stays trusted and now keeps the user, so the write is attributed to them: a folder records them as its creator, and collection hooks are handed them.
