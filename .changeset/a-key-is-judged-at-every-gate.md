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

A scoped API key is judged on its own grants at every access gate, not only the
first one. Transaction writes, field-level access rules and the coarse
collection gate all resolved the permissions of the key's OWNER when the key's
own scope did not reach them, so a key issued to read could act with the
authority of whoever created it.

A permission now reaches a code-defined `access` rule in the spelling those
rules are documented to receive (`posts:read`), so a rule written as
`({ permissions }) => permissions.includes("posts:read")` decides the same way
for an API key as it does for a session.

The scope a plugin route handler receives is its own copy. Narrowing it in place
now affects only that request, where before it edited the key's real grants for
every request for the next five minutes.
