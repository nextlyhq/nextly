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

Page Builder: save a selection as a component, or convert it into one, from the editor.

- **Save as component** and **Convert to component** sit in the block toolbar's new "More" menu, the right-click menu, the block card's menu and the command palette. Each is dimmed with the reason when it cannot run: a selection with a gap, a locked block a convert would take off the page, or an author who may not create and publish components.
- The form names the component and asks which values each placement may change. The picker lists every block in the selection with the props a placement could set and refuses, in words, a prop inside an area locked to its content. When it opens, a dry run says what a convert would break (a link to an id inside the selection) or why it cannot run.
- A convert replaces the selection with a placement as one undoable step, and saves nothing else of the page. The component is created published, so a converted page renders the same once it is published.
- New plugin route `POST /components/from-selection` (`@experimental`): `save-as` or `convert`, in `library` mode (the editor applies the returned page ops) or `stored` mode (the component's create and the stored page's update run in one transaction, as the caller). It takes `dryRun`, refuses a convert that would nest components past the depth limit, and reports who ran it, by user or API key.
- `planConvertToComponent` (blocks-engine) takes the definitions a page places and refuses a convert that would compose past the depth limit, with the new cause `composed-depth`.

**Compatibility (`@nextlyhq/builder`):** `ToolbarActionId` gains `"save-as-component"` and `"convert-to-component"`, and `ToolbarAction` an optional `inMenu`. Code keeping an exhaustive `Record<ToolbarActionId, …>` or `switch` over the ids adds the two entries; `blockActionRunners` already covers them, running the host's verbs when it offers them and nothing otherwise.
