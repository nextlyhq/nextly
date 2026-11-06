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
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-mcp": patch
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

A placed component is named by what the author placed. In the page builder's Layers panel, its bottom bar, its search and a page's list of sections on the entry screen, a placement read "Component instance", the engine's name for its node type. It now reads as the name the author gave the placement, else the component's title, else "Component". In Layers the placement's row also carries the component mark in the component colour and the word "component" after a title, so a title is not mistaken for a block's own name. The editor's other messages that name a block, such as a toolbar action's lock reason, now say "Component" for a placement too.

`@nextlyhq/builder` adds `componentTitles(components)`, which builds a title lookup from a component library's rows, and the `ComponentTitleOf` type. `layerLabel`, `layersOf` and `pathTo` take that lookup as an optional last argument, and `LayersPanel`, `SelectionBreadcrumb` and `EditorCommandPalette` take it as `componentTitle`. Without it a placement reads "Component". `LayerNode` gains `component`, true for a placement.
