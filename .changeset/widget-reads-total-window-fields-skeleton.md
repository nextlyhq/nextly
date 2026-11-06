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

A widget's `load` can read more of what a dashboard card shows, through the same read services, as the person viewing the card. All of it is `@experimental`.

- **`count(collection, { window })`** counts the entries whose `dateField`
  (`createdAt` when absent) falls in a range's window, the one a `timeseries`
  over that range is drawn across; `previous: true` counts the window as long
  that ends where that one starts. The type is `WidgetCountWindow`.
- **`find(collection, { total: true })`** also answers `total`, how many
  entries the same read matched, and `atLeast: true` when that is a floor. A
  `limit` of `0` now answers no rows rather than one, agreeing with
  `rowsThatFit`, which is `0` for a card too short to hold a row.
- **`groupBy`** answers `truncated: true` when groups were left out and
  `atLeast: true` when its counts are floors.
- **`describe(collection)`** answers `{ title?, status, fields }`
  (`WidgetCollectionDescription`): the field that titles an entry, whether the
  collection has a draft and published `status`, and each field the viewer may
  read with its `name`, its `label` (the collection's own, or the field's
  name made readable as the admin names it, "Created At" for `createdAt`),
  `type`, `choices`, and `groupable: false` / `presentable: false` where they
  apply (`WidgetCollectionField`). It is checked as a read of the collection
  is.
- **A `dateField`** for `count`'s window or for `timeseries` must be a date
  field of the collection that every reader of it may read; any other is
  refused, the same way for everyone.
- **`skeleton`** on `defineWidget` (`"figure"`, `"list"`, `"bars"`,
  `"series"` or `"table"`, the type `WidgetSkeleton`) is the shape a card
  loads in and the sketch its add-panel row is drawn with. It is checked at
  startup like every other field.
- **A window that ends now** (a ranged `timeseries`, `count`'s current
  window, a `since` read with no `until`) now keeps the whole second it is
  read in. MySQL stores a `DATETIME` to the nearest second, so an entry made
  just before a read could be stored a moment after it and left out until the
  clock passed it; it is counted now, with no change to stored values.
- **A load's `size`** is held to a site's `overrides` size bounds where they
  narrow the widget's own, as the admin draws the card.
- **The admin** warns once per card, while developing, about a second
  `Widget.FooterLink` in one card, rather than on every change of their count.
