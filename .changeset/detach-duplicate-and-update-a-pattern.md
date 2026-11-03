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

Page Builder: detach a placement, duplicate its component, and update a pattern from a selection, from the editor.

- **Detach from component**, in the block toolbar's More menu, the right-click menu, the block card's menu and the command palette, replaces a placement with the plain blocks it draws, as one undoable step. The blocks look exactly as they did: the placement's own values, its variant and the content in its slots are kept, and a component placed inside it stays a placement. The form says first when the component has unpublished changes.
- **Duplicate component** copies the placement's component under a new name, published, and points that one placement at the copy, keeping its values. Other placements keep the original. Where the copy came from is recorded in the plugin's own bookkeeping.
- **Update a pattern** replaces a pattern's content with the selection, published. Pages that inserted it earlier keep their copies.
- New plugin routes (`@experimental`): `POST /components/detach`, `POST /components/:id/duplicate` and `POST /patterns/:id/from-selection`. Each takes `dryRun`, runs as the caller and reports who ran it, by user or API key. Detach and duplicate take a placement in a page the caller holds (`library`) or in a stored page (`stored`), where a duplicate's create and the page's update run in one transaction.

**Compatibility (`@nextlyhq/builder`):** `ToolbarActionId` gains `"detach-component"`, `"duplicate-component"` and `"update-pattern"`. `toolbarActions` emits `duplicate-component` (and `detach-component` when the offer carries `definitions`, `update-pattern` when it carries `mayUpdatePattern`) for a host that passes a component offer. Code keeping an exhaustive `Record<ToolbarActionId, …>` or `switch` adds the three entries; a dispatcher that does not know an id should ignore it, as `blockActionRunners` runs a verb only when the host supplies it.
