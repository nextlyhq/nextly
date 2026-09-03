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
"@nextlyhq/plugin-form-builder": patch
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

Patterns, components and layouts are now three stores the page builder ships,
so a site can keep saved starting points and reusable pieces beside its pages.

- **Patterns** are copied when you insert them. A pattern carries a title,
  description, category, keywords and a granularity, so the library can be
  browsed and searched rather than scrolled.
- **Components** are placed by reference, so editing one changes every page
  that carries it. A component may name the Layout area it suits, which is how
  a site header stays out of the ordinary insert list without being a
  different kind of thing.
- **Layouts** name which component fills each area around a page. Areas are
  rows rather than columns, so adding an announcement bar or a sidebar later
  costs no migration.

All three separate saving from publishing: a draft is worked on privately and
publishing is the single act that ships it. Each appears in the admin behind
its own read permission, and each accepts only its own kind of document, so a
page cannot be stored as a pattern.

A Layout may fill each area only once, so one Layout cannot name two headers
and leave whatever reads it first to decide which page gets which.

Plugin menu items may now name the collection they point at, with
`collection: "patterns"` beside `to`. The item's destination and its read
permission are then derived from the slug the host actually registered, so a
`.rename({ patterns: "saved-patterns" })` no longer leaves the link pointing
at a list that does not exist or gates it on a permission nobody is seeded.

Nothing yet renders a component instance or resolves a Layout — this is the
storage and the permissions the rest of the feature is built on.
