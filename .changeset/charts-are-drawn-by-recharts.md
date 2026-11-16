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

The dashboard's charts are drawn by Recharts 3, behind the admin's own chart components, and
look as the redesign draws them: an area under a line with its value axis, gridlines and dates,
and a dashed rule, a hollow point and a tooltip on the point in view; a chart of groups as rows of
name, bar and count. `GroupsChart` and `OverTimeChart` keep their names and props.

- The chart engine loads only where a chart is drawn, never in what the admin loads before its
  first screen, and no published type names it. A new CI check, `check-bundle-boundaries`, holds
  both.
- Every chart's numbers are in a visually hidden table that assistive tech can always reach, in
  place of the "View as table" disclosure, which hid them until opened.
- A chart animates its marks in only when the person has not asked for reduced motion.
- A chart of statuses keeps each status's colour on every card. A chart of any other field draws
  every bar in the first chart colour, where each value used to take a colour hashed from it.
- The five chart colours, `--nx-chart-1` to `--nx-chart-5`, are re-tuned so that each pair stays
  apart for readers with protanopia, deuteranopia or tritanopia, in light and dark, and still
  clear 3:1 against the card, a bar's track and the tooltip. A theme that sets its own chart
  colours is unaffected.
