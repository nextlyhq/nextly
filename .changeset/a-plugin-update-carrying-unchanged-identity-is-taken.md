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
account from. An address stored in mixed case before addresses were lowercased
is still rewritten in lowercase, so sign-in can find it. When an address moves,
a verification date carried with it is recorded as the updater's vouching, not
kept as whoever verified the old address.

The update schema now takes a verification date as a `Date` or an ISO 8601
date-time string, and refuses any other string with `VALIDATION_ERROR`. A string
failed every update before, and `"0"` would have parsed as the year 2000.

When a plugin's update is judged, a stored password counts as one when it is a
hash core made, or, where the app passes its own `passwordHasher` to
`getNextly`, whatever that hasher stored.

The plugin services documentation now says that `ctx.services.users.create`
refuses a missing password with `VALIDATION_ERROR` once an account exists, and
with `FORBIDDEN` on an empty install.
