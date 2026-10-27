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

A built-in Public role is added: the role visitors will be judged by. It holds nothing and does not change access yet. It can't be deleted, renamed, given to a person or an API key, or joined to another role's inheritance; only its permissions can be set.

A site whose own role already used the slug `public` keeps that role under the next free slug (`public-1`, `public-2`, …) on the first boot of this version, with its name, holders, permissions and inheritance unchanged, and the change is logged. Code access rules that check the role slug `public` must check the new slug instead.

Saving a role in the admin keeps its slug.

An app or plugin role declared with the slug `public` is refused at boot, as one declared with `super-admin` already is.
