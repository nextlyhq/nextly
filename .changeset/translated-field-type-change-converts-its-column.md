---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/plugin-mcp": patch
"@nextlyhq/ui": patch
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
---

A translated field's type change now gives its translations column the new type. The Schema Builder save writes the column's change in a companion migration file of its own, `retypes`, ahead of the main one, and judges each language's value before anything runs. `nextly migrate` groups that file with its change and judges each language's value before either runs. A value one language holds that the new type cannot read refuses the change, naming that language's row. Such a change was refused before, whatever its values. It stays refused where the road doesn't carry the column's change: a change whose translations column changes only on a database other than the file's, a Single's save, and the code-first reload, `db:sync` and REST. A build before this one refuses a `retypes` file (header version 8) as one it does not support.
