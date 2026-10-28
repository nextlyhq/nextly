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

A site's `admin.dashboard` `hide`, `replace` and `overrides` now take effect. A hidden widget,
a built-in an alternative replaces, and an alternative no `replace` names are offered to nobody
and drawn on no dashboard; their saved cards are kept and come back if the config changes. The
default places an alternative where the built-in it replaces was. An override's title,
description, narrowed sizes and starting settings apply wherever the widget is offered, drawn or
answered. Only `widgets` is still checked but not applied, and startup says so.

A default card's `id` must hold text, as the layout endpoint requires; a reader's stored choice
carries only to a card of the same widget; the dashboard's token tells apart any two sets of
withheld cards; and a reset staged by a reader with an arranged dashboard is refused when a card
of the default it would return to has since changed whether it shows.
