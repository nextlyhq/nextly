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

A template can draw the entry's own blocks content with the new Entry content block (`core/entry-content`), offered under Entry in the Add panel while a template is open. Its Field menu chooses one of the collection's top-level blocks fields; the canvas draws the previewed entry's content read-only, with an at-rest mark and notes for no entry, an empty field and a removed one, and the published page draws the field as the public reads it, or nothing. A template holds one, and one anywhere else, an entry's own blocks field included, is refused at save, as is a field the collection doesn't have; a template whose field was removed keeps saving. The page actions route gains `place-entry-content` and `set-entry-content-field`. The engine exports `composeEntryContent` and the block's rules, `PageContext` gains `entryContentCanvas`, and `@nextlyhq/builder/shell` exports `usePreviewedCollection`, all experimental. Also: a template's preview reads the canvas again with the entry when the window regains focus, and `BuilderShell` draws no band for a `canvasStrip` that draws nothing (`null` or `false`).
