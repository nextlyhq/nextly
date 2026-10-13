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
---

A plugin's update to an account core made for an externally verified person no
longer fails when it carries the account's own address or verification date
unchanged, as a full-object update does. Before, the unchanged address was
judged as a move to another address and refused with `FORBIDDEN`, and the
unchanged date was judged as a fresh verification, refused for the same reason
and, on other accounts, restamped as vouched for by the plugin.

An update that carries an account's address unchanged no longer writes it, so a
stale update cannot put back an address another request has since moved the
account from. A verification date sent as an ISO string, which the update schema
accepts, is now stored instead of failing the update.

A stored password value that is not a hash now counts as no password when a
plugin's update is judged, since it signs nobody in.

The plugin services documentation now says that `ctx.services.users.create`
refuses a missing password with `VALIDATION_ERROR`, rather than `FORBIDDEN`.
