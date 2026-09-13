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
"@nextlyhq/plugin-mcp": patch
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

A reader can send a first-run card away from the card itself, and dismissing one no longer stops later widgets from reaching them.

A widget declaring `dismissible` draws a control on the card, outside edit mode: a card that addresses somebody who has just arrived should not require discovering the dashboard editor first. Framed cards carry it in their header; unframed cards float it in the free corner. It is offered only from the width at which editing -- the one route to bringing a card back -- is available, and `dismissible` must be a boolean on both declaration channels.

Dismissing hides the placement rather than deleting it. The write has its own channel, so its failures never reach the editor's chrome, it locks every other layout write while it is in flight, it confirms against the refreshed dashboard before announcing, and focus moves into the widgets region when the card holding it goes.

A layout row now records whether its reader ARRANGED it. A row written only by dismissals still follows the live registry -- a widget declared later is placed, and positions track the declared order -- with the reader's dismissals applied. The editor's save takes charge of the arrangement, and a row once arranged stays arranged whatever a later write says. Every row written before this reads as arranged, so existing dashboards are unchanged; the flag lives in the stored JSON, so nothing migrates on any dialect.

`toggleHidden` and `remove` now announce through the grid's live region, where both used to change the dashboard in silence.
