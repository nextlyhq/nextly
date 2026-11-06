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

The site config can shape the dashboard: `admin.dashboard`, checked at startup.

- **`widgets`, `hide`, `overrides`, `defaultLayout`, `suggestions` and `replace`** are accepted and checked, but **not applied yet** in this version. Startup logs one warning naming each one a site sets. The site's own widgets, declared with `defineWidget()` as a plugin's are, are checked together with the plugins' widgets, and other keys may name them.
- **Startup refuses a site config that names a widget that does not exist** (with the nearest id), or that uses a key `admin.dashboard`, an `overrides` entry or a `defaultLayout` card does not take (with the key it most likely meant). An id in the `collection/` or `single/` namespace, a card core derives from the content later, is not refused as unknown at startup; its entry's shape is still checked. It also refuses:
  - a width a widget does not allow, or widths that widen rather than narrow;
  - a setting a widget does not declare, or a value it does not accept;
  - a title or a description that breaks the declaration rules;
  - a default dashboard with more cards than a dashboard holds, or that lists a widget allowing one card more than once;
  - a default or a replacement naming a hidden widget, or a replacement no plugin offers for that built-in.
- **A plugin's `suggest` and `alternatives`** may name only its own widgets, and an alternative only in place of a built-in that exists. A plugin's dashboard contribution is read once at startup, every check reads that copy, and a key it does not take is refused with the key it most likely meant.
- **All startup faults are reported together** with the widget declarations' own.
- `AdminDashboardConfig`, `WidgetRef`, `DefaultLayoutCard` and `WidgetOverride` are exported from `nextly`.

All of it is `@experimental` while the dashboard widget SDK is built.
