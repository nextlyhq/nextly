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
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
---

Typecheck the block renderer’s own tests, and give block authors a typed defineBlock.

The package excluded test files from tsc, so its tests had never been typechecked. Adding a tests project surfaced eleven errors, nine of which shared one cause: the engine types a slot’s output as unknown because it carries no React types, so a block author could not place it in their own JSX without annotating every render by hand.

@nextlyhq/blocks-react now exports its own defineBlock, which names the context and the slot return type. This is the same service the plugin SDK performs for plugin authors, offered to anyone rendering with this package directly.
