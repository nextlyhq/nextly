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

In the Schema Builder's outline, every way of moving a field now follows the one move rule: Move up and Move down, a new Move to… (every place a field could go, told apart, with the position there, and the reason for each place it may not go), Alt+arrow keys (Alt+Left out of a container, Alt+Right into the one above it, named in each row's description), and drag, where moving the pointer sideways changes the level. Each move is announced and keeps focus on the field. Moving a field into or out of a group or repeating rows is refused for now, saying it is not available yet, until a save keeps the field's values when it changes container; reorders within a container go ahead. Duplicate now puts the copy right after the original, under a name that clashes with nothing beside it, in letter case or column, nor with a field whose delete is still unsaved.
