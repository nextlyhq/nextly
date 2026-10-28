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

A widget declared with `defineWidget` can now read groups and counts over time,
choose where it is offered, and gate who sees it on several permissions. All of
it is `@experimental`.

- **`services.groupBy(collection, { field?, where?, status?, limit? })`** answers
  `{ buckets }`, the data the `bars` view draws, so `load` can return it as it
  comes. With no `field`, it groups by the collection's own field: its status
  when it has drafts, otherwise its first field with choices, as a card's Group
  by setting does.
- **`services.timeseries(collection, { range, dateField?, where?, status? })`**
  answers `{ points, interval }`, the data the `series` view draws. `range` is
  `"7d"`, `"30d"`, `"90d"` or `"12m"`, the values `settings.dateRange()` offers;
  the range picks the interval (a day, a week or a month), and `interval` says
  which one the points were counted in. Entries are placed by `createdAt` unless
  `dateField` names another date.
- **`status: "published" | "all"`** on `count`, `find`, `groupBy` and
  `timeseries`. Reads count published entries, as before, unless they ask for
  `"all"`, which includes drafts. Every read still runs as the person viewing
  the card, with their read access.
- **`offered: "per-collection" | "on-request"`** on `defineWidget`, the same
  values a registered widget's `offered` takes. A widget offered per collection
  needs a Collection setting, and startup refuses any other value.
  `several: false` now holds such a widget to one card: it was dropped before,
  and an offered widget allows several by default.
- **`access`** also takes `{ anyOf: [...] }` (any one of several permissions)
  and `{ allOf: [...] }` (every entry, each a permission or `{ anyOf }`). These
  forms decide who is offered the widget, as a single permission name does. A
  bare list is refused at startup, with a message pointing to `{ anyOf }`. An
  `access` function may now be async and return any value; only `true` lets
  the person see the card.
- **New types** `WidgetAccessGate`, `WidgetInterval` and `WidgetRange`,
  exported from `nextly` and `@nextlyhq/plugin-sdk`.
- **`Widget.FooterLink`** in `@nextlyhq/plugin-sdk/admin`:
  `<Widget.FooterLink href label />` draws a link in the card's own footer,
  where core's cards put "View all". It replaces the widget's own link while
  it is shown, so the footer still holds only one link.
