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

The last active super-admin can no longer be deleted, deactivated or have the
role taken away. Only removing the role was refused before, and only through
one REST route; a delete or a deactivation from the admin, the REST API or the
Direct API went through and left an install nobody could administer, with the
database edited by hand the only way back. Each of those removals, and the
role's removal through any path, is now refused with `409 CONFLICT`: make
another user super-admin first.

The refusal is decided inside the removal's own transaction, under a lock
every removal takes, so two requests sent at once to remove the last two
super-admins leave one: the admin's bulk delete sends exactly such requests.
What is kept is an active account holding the `super-admin` role itself. A
role built on `super-admin` grants the same authority, but its inheritance can
be edited away and the role deleted, so an account that is a super-admin only
through it does not count; nor does a deactivated account.

The refusal of a role removal changes shape: it was `400` with a bare
`{ "error": "..." }` body, and is now `409` in the standard error envelope.
`DELETE /api/users/:id/roles/:roleId` answers this refusal with the same
`409`.
