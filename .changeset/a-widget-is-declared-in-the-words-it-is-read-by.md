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
---

`defineWidget` takes its fields by the names a widget is read by, and startup
names every fault of every owner in one message.

**Breaking for `defineWidget` (`@experimental`).** The fields are renamed, with
no old spelling kept:

- `data` is now `load`.
- `display` is now `view`, which is one of core's views (`"figure"`, `"list"`,
  `"table"`, `"bars"`, `"series"`) or `{ component: "<module>#<Export>" }`.
  Today's display names are not view names: `"metric"` is now `"figure"`, and
  `"timeseries"` is now `"series"`.
- `empty.when` is now the top-level `isEmpty`, and a view with its own
  component must give it. `empty` holds the message and the action.
- `example` is now `preview`, a list of named cases, each checked against the
  widget's data and settings types. A case is written
  `{ name, data, settings? }`.
- `permission` is now `access`.
- `sketch` is removed: the add panel draws the view's own sketch.

A declaration still using an old name is refused at startup, and the message
names the field that replaced it.

**New, all `@experimental`:**

- An `icon` field.
- `category` is optional, and defaults to "Other".
- The `CoreView`, `WidgetView`, `WidgetAccess`, `WidgetPreviewCase` and
  `WidgetSummary` types, exported from `nextly` and `@nextlyhq/plugin-sdk`.

**Typed now, judged in a later release:**

- `access` as the collections a widget reads, or as a predicate of the person;
- `shows`;
- `summary`, a label and a count for the dashboard's header.

Until that release, a declaration using any of these is refused at startup
rather than started with the rule ignored.

**Startup:**

- Core's own widgets, every plugin's and the site's go through one
  registration, so a fault in core's list and a plugin's fault arrive in the
  same message, and nothing is kept until every check passes.
- A long title or description no longer stops startup.
- Core's widget list is one module per widget under `core-widgets/`.

**Core's Note card is declared with `defineWidget`**, as a plugin's widget is.
It reads the same to its reader, with one exception: an unwritten note's empty
state now reads "Nothing written yet. Write it in the card's settings.", drawn
by the card's frame like every other empty card.
