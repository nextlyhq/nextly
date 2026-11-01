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

The dashboard header gains a New button beside Customize. Its main part
creates the type a person created most recently (or the first they may
create), and its menu lists the recent types, then every type they may create,
grouped as the sidebar groups them, with a search past ten. It is hidden for
someone who may create nothing. The command palette offers "Create <type>" for
each type too. A type is remembered as recent when an entry of it is created,
from anywhere in the admin, not when its form is opened.

The Create card is removed: `core/quick-create` is no longer a core widget, and
core's default dashboard gives Needs attention its row. Its id is now a retired
card, as the per-collection and per-Single cards are: a site whose
`admin.dashboard.defaultLayout` (or `hide` or `overrides`) still names it is
refused at startup with a message saying creating entries now lives in the
dashboard header's New button, so remove it from the config. A saved layout
holding it reads without it.

The header holds its layout from the first paint: the summary line's height,
Customize's place and the New button's fixed width are reserved before their
data arrives, so nothing in the header moves as the dashboard loads.
