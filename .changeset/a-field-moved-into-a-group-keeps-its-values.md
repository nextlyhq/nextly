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

A field moved into a group, or out of one, in the Schema Builder now keeps every entry's value. The Builder sends each move with the save (`hints.moves`: the field's path before and after), and the save's migration file copies the values into their new place before it drops the old column, or after it adds the new one. The file's way down copies them back. The review and the file's header name what the old column had that a group's JSON value cannot hold: its type, NOT NULL, indexes, comment, character set and collation.

A move that cannot keep its values is refused before anything is written, with a sentence saying why. That covers a unique field, a field whose translation would change, a move into a repeater or out of one, a field group or Blocks field, a move into a group created in the same save, and a move out of a group deleted in the same save. For now, a move in a translated collection is refused too.
