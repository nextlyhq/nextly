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

The dashboard's Recently edited card is replaced by **Continue where you left
off**. Its header offers two tabs, as a segmented control: **Mine**, the default, lists the entries and
Singles you pinned, in the order you pinned them, then the ones you saved most
recently; **Team** lists what other people saved most recently, each with who
saved it. Every row shows the collection's icon, the entry's title, "<collection>
· edited <time>" and its status (Draft, Published, Changed, Scheduled), opens the
entry, and has Pin or Unpin in its "…" menu. A title is read as you may read it
now: an entry you can no longer read, or one that was deleted, is left out.

Removed, with no alias: the `core/recently-edited` widget and the
`system:recent-edits` source. A saved dashboard naming `core/recently-edited`
keeps an empty place for it until the reader arranges it again; a site config
that names it (`defaultLayout`, `hide`, `replace`, `overrides`) is refused at
startup and should name `core/continue` instead. The exported `CoreWidgetId`
type names `core/continue` in its place. A widget source may now narrow by a
`tab` filter (`"mine"` or `"team"`, `@experimental`).

A card's quick setting that is a choice of exactly two options is now drawn on
its header as a segmented control (a radio group: the arrows, Home and End move
and choose) rather than a dropdown; a choice of any other number of options
keeps the dropdown.

Pins: a pin whose entry or Single no longer exists is removed when your pins
are read and no longer counts toward the limit of 20, and two pins made at the
same moment can no longer take a reader past that limit.
