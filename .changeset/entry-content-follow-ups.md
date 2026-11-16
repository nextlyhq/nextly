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
  page may draw is cut before any of it is walked or copied. The template is charged
  what it draws once its components are expanded, so a placement still resolves when the
  entry fills the page.
- On the editor's canvas the entry's drawn blocks are inert, so no link or field inside
  takes focus or a press; a click still selects Entry content.
- Applying conditions judges the blocks inside the entry's own content with the
  template's: a hidden one is drawn as its line inside Entry content and counted, and the
  switch is offered when only those blocks have conditions.
- After a refresh, the Previewing strip names the entry only once both the entry's read
  and the canvas's read from that refresh have answered.
- Save as pattern, Update a pattern and Turn into component are turned off, with the
  reason, while the selection holds Entry content.
- A blocks field inside a repeater is never offered or accepted as Entry content's field:
  only fields stored on the entry itself, directly or in an unnamed group, are.
