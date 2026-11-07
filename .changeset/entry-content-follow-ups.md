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

Follow-ups to a template's Entry content block.

- The entry's own DOM ids are claimed against every id the template already publishes,
  as a placed component's are, so a minted id is never rendered twice.
- Composing an entry's content keeps to the page's node limit: an entry larger than the
  page may draw is cut before any of it is walked or copied.
- On the editor's canvas the entry's drawn blocks are inert, so no link or field inside
  takes focus or a press; a click still selects Entry content.
- Applying conditions judges the blocks inside the entry's own content with the
  template's: a hidden one is drawn as its line inside Entry content and counted, and the
  switch is offered when only those blocks have conditions.
  With conditions not applied, they carry their Conditional badge, and while the window's
  refresh reads the entry again they stay drawn and counted.
- After a refresh, the Previewing strip names the entry only once both the entry's read
  and the canvas's read from that refresh have answered.
- Save as pattern, Update a pattern and Turn into component are turned off, with the
  reason, while the selection holds Entry content.
- A blocks field inside a repeater is never offered or accepted as Entry content's field:
  only fields stored on the entry itself are, directly or inside a presentation-only
  container (an unnamed group, row, tabs or collapsible).
- `nextly` and `@nextlyhq/plugin-sdk` export `storedAtThisLevel`, the one rule for which
  unnamed containers store their children at their own level, for `addressableFields`'
  `descendInto`. The binding sources' field shapes, the widget sources and the field-rule
  registry now take it too, so the fields of an unnamed row, tabs or collapsible are read
  where they are stored, as an unnamed group's always were.
