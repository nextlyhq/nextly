---
"nextly": patch
"@nextlyhq/plugin-accounts": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/plugin-mcp": patch
"@nextlyhq/ui": patch
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/plugin-commerce": patch
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

The Count card in the add panel, and content widgets that ask only what they draw.

- **The add panel's Content group is shown.** It lists Count once for each collection the reader may read, and its rows carry the widget's category, so a search by category finds them.
- **A card set to a collection names it** in its title ("Count: Posts"), and Count names it in its number's accessible name, so two cards for different collections can be told apart.
- **Count's Retry** asks a failed card again.
- **A custom card's cells:**
  - A cell may declare `drawnFrom`, the narrowest tier that draws it. The admin asks only the cells a card's tier draws, and asks the rest when the card widens.
  - A cell's `when` is judged by the collection that cell reads once the settings apply.
  - Each cell is keyed by its declared query, so changing one card's settings asks that card again alone.
  - The settings preview asks the cells under the sheet's values.
- **A component's settings are the ones its query was asked with.** A stored Filter, Sort or Group by that the query set aside is not handed on. `effectiveWidgetSettings` gives that reading, and `KnobField` is exported beside `KnobContext`.
- **Registration refuses:**
  - a custom card declaring both a query and cells;
  - a widget offered per collection with no Collection setting;
  - an `offered` value other than `"per-collection"`;
  - a content setting that no cell's source lets a knob drive.
- **A timeseries with `until`** draws its intervals up to that boundary, where its rows end.
- **Whether a caller has a release to read** is asked once per batch, not once per collection.

All of it is `@experimental` while the content widgets are built.
