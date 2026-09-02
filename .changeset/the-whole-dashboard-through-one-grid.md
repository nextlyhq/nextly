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
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
"nextly": patch
"@nextlyhq/plugin-form-builder": patch
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
---

The whole dashboard is drawn by one grid.

Core's four dashboard cards — the seed prompt, collection counts, singles and the
team summary — are widgets now, registered through the same `registerWidget` door
a plugin uses and resolved from reserved `core#` component paths. The dashboard
page mounts a welcome header and the grid; nothing else.

Until now the grid drew only what plugins contributed, and nothing contributes a
widget yet, so a real dashboard rendered none of the widget system while the
cards a user actually saw sat hardcoded above it.

Two new optional fields make that possible without changing what anyone sees:

- `defaultOrder` states where a widget sits. Position previously depended on
  which channel a widget arrived through, since registrations resolve after
  contributions. Absent sorts last, so every existing dashboard keeps its order.
- `chrome: "none"` lets a `custom` widget decline the card frame when it is
  already a designed surface. Refused on every archetype core draws, where the
  card owns the title and the busy state.

A grid cell whose widget draws nothing now collapses, so a card that hides itself
leaves no gap.
