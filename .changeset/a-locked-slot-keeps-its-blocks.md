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

A slot a block locks now keeps the blocks it starts with. `SlotSpec.lock` was
declared and exported but nothing read it, so a block author locking a region
protected nothing.

A document whose locked slot does not hold exactly its starting children, the
ones inserting the block creates from `defaultBlock`, is now refused when it is
saved, with the block and the slot named. That holds whoever writes the page:
the editor, the API, an import or an agent. `"all"` and `"contentOnly"` fix the
children and their order, and `"insert"` fixes which children the slot holds
while letting them be reordered. A slot that declares no lock takes the lock of
the slot its block sits in, and `false` stops that, except beneath
`"contentOnly"`.

Registering a block whose slot declares any other lock value now fails with a
message naming the block and the slot. `validateDocument` takes an optional
`definitions` source to check locks against, and `registryBlockSource` is now
exported from `@nextlyhq/blocks-engine`; the builder's export of the same name
is unchanged. Changing what a locked slot starts with changes the block's
stored shape, so bump its `version` and migrate the nodes already stored.
