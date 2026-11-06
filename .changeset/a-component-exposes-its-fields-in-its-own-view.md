---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
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
---

A designer exposes a component's fields in the component's own Page Builder
view.

Each property of a block inside the component has an "Expose to placements"
switch and a name, and each block a "Let placements hide this" switch. With
nothing selected, the inspector lists the component's exposed fields and slots
to rename or remove. A removal asks first, naming every variant that loses a
value. A property placements could not set, or one inside an area locked to its
content, is refused with the reason.

The engine gains an `envelope` op, so an exposure edit is one undo step like any
other edit. `BuilderOp` (published by `@nextlyhq/blocks-engine` and re-exported by
`@nextlyhq/builder`) gains this fifth member: code that builds or applies ops is
unaffected, and an exhaustive `switch` over `op.kind` needs a case for
`"envelope"` or a default. A new field's id stays clear of every id the component's live
definition still uses or has retired, read from a new `/component-facts`
route, which also counts the documents that place the component directly.
