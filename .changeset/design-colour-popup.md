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

A variable's editor in the Design panel now opens with everything about it
in one place.

- **Values.** "☀ Light" and "☾ Dark" each have their value and picker. With
  no dark value, the editor says "Same as light" and offers "Add dark
  value".
- **Usage.** How widely the variable is used, with a "Show where" list of
  the places. A variable the site's code supplies says this too.
- **Code name.** "Code name: --site-…" with a Copy button. A variable never
  saved shows the code name its name would give it, updated on every
  keystroke. A saved one keeps its code name through every rename, and says
  "Stays the same when you rename, so CSS that uses it keeps working".
- **Contrast**, for a colour: with the site's Background and Text, in light
  and in dark. Each is a ratio to two decimals, with "Readable as text"
  (4.5:1 or more), "Large text only" (3:1 or more) or "Low contrast". A
  colour with no dark value says "Same in dark mode" beside its dark ratios
  where Background changes in dark mode.

A dark value is offered on colours and shadows only. A size, a type size, a
weight, a number, a duration or a custom value no longer offers one. One
that already holds a dark value, from an import, still shows and uses it,
and "Remove dark value" takes it away. "Use light value" is now "Remove dark
value" everywhere.
