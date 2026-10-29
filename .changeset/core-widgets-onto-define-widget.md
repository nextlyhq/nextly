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

Core's Count, Breakdown, Over time and Recent entries cards are declared with `defineWidget`, as Note is: each card's data is answered on the server by its declaration's `load`, through the public read services alone and for the size the card is drawn at, and its admin component draws that data. Each keeps its id, title, description, sizes, settings and what it shows.

- **Count** reads its number at every size, what scheduled releases will
  publish from the medium tier, and on a large card alone the last 30 days as
  a series over that range and the 30 days before them as a count over the
  window as long that ends where the series starts.
- **Recent entries** asks the rows its height holds at its density, at most
  its "Number of items", and one more that says more exist.
- **Breakdown, Over time and Count's trend** draw "View as table" under their
  chart: a button that swaps the chart for a table of the same values in the
  card, closed again with Escape, which hands focus back to the button.
- **Each card loads in its own shape** again: a figure, bars, a series or a
  list, and its add-panel row is sketched the same way.
- **Team** stays as it is, and is no longer on the default dashboard: a reader
  who manages the team adds it from the add panel.
- **`overrideWidget()`** now refuses the four moved ids, as it refuses every
  declared widget; `extendWidget()` still applies to them.
- A Filter of no conditions adds nothing to a widget's query, rather than an
  empty `where`.
- **A series over a range** counts, in its last interval, a row MySQL stored
  rounded across that interval's end within the second it is read in, as a
  windowed count of the same range does; on MySQL the series' scan bound now
  keeps that second.
- **A windowed `count`** checks the call's own `where` as written before
  narrowing it to the window, so a malformed filter is refused exactly as it
  is without a window, never wrapped and run.
- **A declared widget's loading skeleton** lays out its rows from its
  `skeleton`: a list loads as a list's rows, and a table as a table with its
  heading and columns on a wide card. Recent entries loads as a table.
