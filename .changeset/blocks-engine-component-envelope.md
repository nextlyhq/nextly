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

A component definition can now say which of its properties an instance may
override, and which regions an instance may fill.

A `component` document carries an `exposed` list — each entry pointing at a
node in its own tree and the prop on it an instance may replace — and a `slots`
map — keyed by slot id — naming the regions an instance may put its own
blocks into. Named variants
preset those values. A component that exposes nothing is still a component: a
footer nobody may edit is the point of one, not an unfinished definition.

Every pointer is checked when the document is validated, and one that does not
resolve is refused rather than stored. Deleting a node, renaming a container's
slot or removing an exposure leaves a definition that still loads and still
renders — the fault only appears later, as an author editing a property and
seeing nothing change on any page carrying the component. The refusal names the
node or slot it could not find, and what the node declares instead.

Component instances gained `overrides`, which distinguishes three states rather
than two: a property absent from the map inherits what the definition or
variant provides, one set to `{ $unset: true }` renders empty, and any other
value replaces. Without the middle state an author could not clear a subtitle
their definition fills in.
