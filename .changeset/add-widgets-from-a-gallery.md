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

Adding a widget to the dashboard now happens in a gallery that shows each widget
once, drawn small by its own view, instead of a list grouped by collection.

Open Add widget in customise mode to search widgets or collections, filter by
All, Content, Activity, Trends or Plugins, and pick from up to four suggested
pairs, such as "Recent Posts" or "Pages over time". Suggestions follow the
collections you saved most in the last 30 days, or the ones with the most
entries if you have saved none. A widget that reads a collection opens a short
add step in the same panel: choose the collection (it starts on the one you
edit most), the period where the widget has one and the width, and see the card
previewed before Add to dashboard. A widget that reads no collection is added
straight away. Searching a collection's name lists each widget that can read it
as a pair, such as "Count · Posts", which adds with that collection chosen.
Cards you removed this session are listed first and come back with their
settings.

What the gallery offers is decided on the server, as the person asking, by the
new `GET /api/dashboard/gallery`. It leaves out any widget whose own `access`
or `shows` refuses them, and any collection they may not read or that is kept
off the dashboard.

Core's Count, Over time, Breakdown and Note widgets now declare a preview case
of sample data, which their gallery tiles are drawn from.
