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

Dashboard widget sources leave out content kept off the dashboard, answer an unavailable source
with a typed code, and name system fields and choice values the way people read them.

- A collection or Single marked `internal`, or hidden from the admin's navigation
  (`admin.hidden`), gets no widget source, no generated card, no place in the Content figures and
  no pending-edit count, for every caller including a super-admin. A widget query naming one is
  refused exactly as an unknown name is. Content a plugin hides because it has screens of its own
  stays reachable there.
- A widget slot refused with the shared "unavailable source or unsupported op" sentence now
  carries `code: "unavailable"`, so a card can show its "not available" state without matching
  the sentence. An unknown collection or Single name now takes a read decision as a forbidden one
  does, rather than being refused before any, so a batch no longer skips that step for the names
  that are not real.
- System columns carry labels (ID, Created, Updated, Status, First published). Status, select and
  radio fields carry their value labels as `choices` on widget sources and on list result fields,
  and a `groupBy` result now describes its grouped field.
- A widget source whose declared value labels a card could not draw (choices that are not a
  list, a value that is not a string, an empty label, or one value named twice) is refused when
  it registers. A select or radio field whose stored options name one value twice keeps the
  first, as the entry form shows it.
- The dashboard's "changed in the last 24 hours" figure leaves out content kept off the
  dashboard, and the Singles card points to the full list, rather than saying there are none,
  when the first Singles it reads are all kept off the dashboard and more follow.
