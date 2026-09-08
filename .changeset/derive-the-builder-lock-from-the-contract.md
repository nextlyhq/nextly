---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
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
---

Publish the custom edit view contract, and give the form builder the lock type
rather than a copy of it.

A plugin registering an Edit view is handed \`CustomEditViewProps\` and had no way
to type against them: the interface was not exported, so the bundled form
builder declared its own \`documentLock\` shape beside the one the admin passes.
Both compiled, and an affordance renamed in the admin would have gone on
compiling on both sides while quietly no longer reaching the write gates that
read it.

The pair the admin hands over is now derived from the affordances the editor
itself acts on, and \`@nextlyhq/plugin-sdk/admin\` republishes both it and the
contract it belongs to. Renaming an affordance now stops the build instead.
