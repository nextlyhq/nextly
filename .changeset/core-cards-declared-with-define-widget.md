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

Core's Content, Team, Continue where you left off, Upcoming releases and Team activity cards are now declared with `defineWidget`, like every other core card but Create, and are answered on the server by their own `load`. A widget's permission gate has one spelling, a declaration's `access` (`WidgetAccessGate`): one permission, `{ anyOf }` or `{ allOf }`. A bare list is no longer a gate, and `{ anyOf }` still opens a card for a holder of any one of its permissions. No setting drives a widget's query because of its name: a number setting called `limit`, a select called `dateRange` or `tab`, and a checkbox called `onlyMine` reach a declared widget's `load` like any other setting.

Removed exports:

- `nextly/widget-result`: `WidgetComponentProps`. A widget's component is handed `WidgetProps`.
- `nextly/widget-gate`: `WidgetPermissionGate`. A gate is typed `WidgetAccessGate`, from `nextly`. To migrate, import `WidgetAccessGate` from `nextly` in its place, set it as a declared widget's `access`, and write a bare list of permissions (`["a", "b"]`) as `{ anyOf: ["a", "b"] }`.

The dashboard layout read no longer sends each widget's add-panel group, sub-group, sketch or rank; its `available` list is already in the add panel's order.
