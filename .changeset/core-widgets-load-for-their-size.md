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

A widget declared with `defineWidget` can load for the size its card is drawn at. A card missing a setting stays readable while the dashboard is customised, and a retired per-collection card is told what replaced it without a guessed name. All of the new API is `@experimental`.

- **`size` on `load`'s input**: `{ w, h, tier }`, the card's grid size within
  the widget's bounds and its tier (`"small"`, `"medium"` or `"large"`), as the
  admin predicts it from the dashboard's width. `shows` is handed the same
  size. A card that is resized or crosses a tier runs its `load` again, on its
  own. A card asked with no tier, such as one judged on the server for a
  default dashboard, is loaded at its stored size, or its widget's default for
  a card not yet saved, at `"medium"`. The type is `WidgetLoadSize`, exported
  from `nextly` and `@nextlyhq/plugin-sdk`.
- **`rowsThatFit(size, { density })`** in `nextly` and at the
  `@nextlyhq/plugin-sdk` root: how many list rows a card of that height draws
  at `"default"` or `"compact"` density, at most ten, by the formula core's own
  list cards use.
- **Customise mode** no longer dims a card's empty, failed or not-available
  message: only an answer is dimmed, so the words that say what to do stay at
  full contrast.
- **A retired `collection/…` card** named in a layout write is told the
  collection to set by its label when exactly one the writer may read made it,
  and otherwise "the collection this card showed", never a slug read back from
  its id.
- **`Widget.FooterLink`** is the one link a card's footer draws: beside a
  `Widget.List` with `viewAllHref` it takes the place of "View all" rather
  than sitting beside it, and in development a second FooterLink in one card
  is named once in the console.
- **A plugin's attention item** reading a declared collection its reader may
  not read has each read checked first, so a malformed one fails for every
  reader alike, and only then is answered as an empty collection.
