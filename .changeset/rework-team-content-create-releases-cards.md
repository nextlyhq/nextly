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

The dashboard's Team, Content, Create and Upcoming releases cards each do what their name says, answered as the person reading them.

- **Team** is offered only to someone who may read people and may add or change them, and it now links to Users.
  - A new `system:team` source answers the number of people, and the number of roles for a reader who may see roles. Without that grant there is no roles figure at all, rather than a zero.
  - The source asks the same rule the card is offered on, so a reader the card isn't for is answered as if the source didn't exist.
- **Widget permission gates** take a third form, `{ allOf: [...] }` (experimental), beside a slug and an any-of array. Every entry must hold, and each entry is a slug or an any-of array. One level only; an empty `allOf`, an empty entry or anything else is refused when the widget is defined. A slug and an array mean exactly what they meant before.
- **Content** shows each collection's entries and its drafts, counted as the reader, through a new `system:content` source. The dashboard's draft/published summary is now the sum of those same rows.
- **Create** no longer offers a shortcut for a collection only a machine creates in (`admin.disableCreate`, as form submissions declare).
- **Upcoming releases** links to Releases, and shows the reader's releases that need attention above the upcoming ones, at every size: "1 stopped · 2 overdue", each part linking to the Releases list filtered to that reason.
  - `system:releases` sends those counts as rows of their own (`kind: "attention"`) only to a query whose `select` names `reason`. Any other query, including one with no `select`, is answered exactly as before.
- The exported `ContentStatsGrid` no longer draws invented trend lines, sparklines or "this week" figures beside its real numbers.
