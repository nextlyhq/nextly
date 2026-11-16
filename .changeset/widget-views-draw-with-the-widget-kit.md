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

A widget's own view now draws with the kit core's own cards are built from, published from
`@nextlyhq/plugin-sdk/admin` (experimental):

- `Widget.Figure`: one number, written for the card's size tier and heard in full.
- `Widget.List`: rows of a title, up to three fields and an end, with at most one visible action
  each and no menu, as many as the card's size and the query's `limit` hold, with the shared
  "View all" footer, which takes the place of the widget's own footer link.
- `Widget.Table`: rows across at most three named columns, drawn as a table on a wide card.
- `Widget.BarChart` and `Widget.SeriesChart`: the dashboard's charts, with an optional `unit`
  their tooltips write after each number ("12 orders").
- `formatWidgetNumber`, `formatWidgetChange` and `widgetChartColour`, from the server-safe
  root `@nextlyhq/plugin-sdk`, so server code can call them too. They are `@nextlyhq/ui`'s
  own formatters and chart colour, and `@nextlyhq/plugin-sdk` now depends on `@nextlyhq/ui`
  for them. `@nextlyhq/ui/format` gains `chartColour` and `ChartSlot`.

Every part draws with the theme's tokens only, in light and dark.

**Breaking, with no alias:** these names are removed from `@nextlyhq/plugin-sdk/admin` and
`@nextlyhq/admin`:

| Removed                                                                                      | Use instead                                                                                                 |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `CardFigure`                                                                                 | `Widget.Figure`                                                                                             |
| `cardNumber`                                                                                 | `formatWidgetNumber`                                                                                        |
| `cardChange`                                                                                 | `formatWidgetChange`                                                                                        |
| `GroupsChart`, `GroupsChartProps`, `GroupsChartGroup`                                        | `Widget.BarChart`, `WidgetBarChartProps`, `WidgetBarChartGroup`                                             |
| `OverTimeChart`, `OverTimeChartProps`, `OverTimeSeries`, `OverTimePoint`, `OverTimeInterval` | `Widget.SeriesChart`, `WidgetSeriesChartProps`, `WidgetSeries`, `WidgetSeriesPoint`, `WidgetSeriesInterval` |

Each replacement takes the same props as the name it replaces.
