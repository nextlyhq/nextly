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

Colours sit in named groups in the Design panel's Colours tab. A new site starts with "Brand" (Primary) and "Text and surfaces" (Text, Background, Surface, Border, Strong border, Muted text). An author can:

- add a group with "+ New group";
- rename or remove a group from its ⋯ menu (a removed group's colours join the group above);
- move a colour by dragging it onto a row or a group's heading, by its ⋯ menu ("Move up", "Move down", "Move to group…"), or with Alt+Up and Alt+Down.

Every author sees the same groups and order, and every colour picker in the builder lists colours in that order.

Groups and order are display-only. A token carries an optional `group` label, and the token set an optional `order` list of identities. Neither is written to the site's CSS, and a move never changes a code name or a value. Both are checked before they're stored. A site that never reorders stores no order.

Older builds must not be run against a site record that has these new parts.
