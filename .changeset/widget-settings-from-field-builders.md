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

A widget's settings are now written with the collections' field builders. `setting.text`, `setting.textarea`, `setting.number`, `setting.checkbox`, `setting.select` and `setting.date` take the config the matching collection field takes, less the `name` the setting's key gives, with a `label` required. Beside them are the dashboard's pickers: `setting.collection`, `setting.fieldOf` (a field of the chosen collection), `setting.dateRange`, `setting.filter`, `setting.sort`, `setting.groupBy` and `setting.fields`. `setting` and the collections' `option` are exported from `@nextlyhq/plugin-sdk` and from `nextly`.

```ts
settings: {
  currency: setting.select({
    label: "Currency",
    options: [option("US dollar", "usd"), option("Euro", "eur")],
    defaultValue: "usd",
    quick: true,
  }),
  collection: setting.collection({ label: "Collection" }),
  sortBy: setting.fieldOf({ of: "collection", label: "Sort by" }),
}
```

Breaking, for the experimental widget SDK only: the `widgetSettings` export from `nextly` is removed. Write `setting.number({ label, defaultValue, min, max })` for `widgetSettings.items()`, `setting.dateRange({ label })` for `dateRange()`, `setting.checkbox({ label, defaultValue })` for `toggle()` and `onlyMine()`, and `setting.select({ label, options, defaultValue })` for `select()` and `chartStyle()`. `default` is now `defaultValue`, as on a collection field.

Startup now refuses a declared setting without a label, and a preview case whose settings name a setting the widget does not declare or a value that setting would refuse. The settings sheet opens a stored value its setting no longer accepts at the default the card falls back to, and a settings fault quoting a value no formatter can print is still reported.
