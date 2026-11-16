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

Page builder: the bottom bar now starts at **Page**, then each block holding the selection,
and choosing **Page** clears the selection. On its right a hint names the keys that work
from there: Enter to edit the selected block's text, Esc to go up, and the command
palette's key. Escape now goes up to the block holding the selection, and clears the
selection only from a top-level block; `escapeOutcome` now answers `"navigate-selection"` for the
key the editor consumes, where it answered `"deselect"`. The editor's words are read from one catalogue,
`EDITOR_WORDS`, exported from `@nextlyhq/builder/shell`. The zoom and device menus no
longer hide the rest of the editor from assistive technology while open.
