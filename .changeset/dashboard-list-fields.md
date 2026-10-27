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

A Recent entries card's reader can choose which of the collection's fields its rows show after
the title, from a new "Fields on each row" setting.

- `settings.fields({ of })` declares a `fields` content setting on a widget (`@experimental`): an
  ordered choice of up to `MAX_CHOSEN_FIELDS` (3, exported from `nextly/config`) of the named
  Collection setting's fields. It must work over a Collection setting with `rows: "titled"`, on a
  widget whose query is a `list`; startup refuses it anywhere else.
- A choice must name only fields the reader is offered and a row can print, the rule a Sort or
  Filter is held to. A field a read rule withholds, or one no row can print (a structured or
  many-valued field), is never offered, and a stored choice naming one falls back to the card's own
  fields. A source marks a field no row can print with `presentable: false`.
- A Collection setting is applied before the settings that depend on it, whatever order a widget
  declares them in.
- The settings sheet draws Fields as a multi-select of the fields it may offer, never the title,
  stops at the most a row shows and says so, and resets a stored choice naming a field no longer
  offered, saying so.
- Recent entries leads each row with its collection's initial, shows the chosen fields in the
  order chosen, and draws its status as a pill on a collection with a lifecycle.
- Every content setting's control names a field by its label, or its name made readable, as the
  card's column headings do, never by its key.
- Dates in list and table cards read short ("Today, 9:40 PM", "Yesterday", "Oct 24, 9:40 PM", with
  the year only when it is not this one), with the full date on hover.
- A clearable select's clear button now sits beside the select rather than over its arrow, and can
  be reached from the keyboard.
