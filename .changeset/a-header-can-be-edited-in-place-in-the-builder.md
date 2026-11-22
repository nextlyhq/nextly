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

The builder can edit a region of the page's layout, a header or footer, in place while the page stays on screen: a second editor state edits the region with an undo history of its own that starts empty and is dropped on leaving, while the page's state stays as it was. The canvas draws the region from its live document with its blocks in reach, and keeps the page and the other region drawn, out of reach and hidden from assistive technology under a dim the editor draws over them. A purple bar above the canvas carries the host's words and Done, which a press on the dim highlights; Layers is headed with the region's name and the inspector names the block in it. A double-click on a region, or Enter on a selected one, asks the host to edit it, and Escape leaves it once nothing inside is selected. Nothing in an app uses it yet: the host supplies the region, its words and its saving.
