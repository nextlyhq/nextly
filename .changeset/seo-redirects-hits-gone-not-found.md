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

The SEO section's Redirects screen is rebuilt on the admin's own list: each redirect shows the
status the site answers (301, 302, or the new 410 Gone for a page removed for good, which needs no
To address), who made it ("You" for your own), how many requests it has answered and when it last
did, counted by the Proxy in the background. Redirects are added and edited in a dialog, removed
from each row's menu, and a CSV file (which may now mark rows `gone` or `410`) is imported after a
dry run in a dialog. Where the Proxy does not run, the list says the redirects are saved but not
served, with the note a developer needs.

The Not found tab shows where visitors came from (another site, a page here, or Direct), narrows by
when an address was last asked for, and lets an address be ignored and shown again. Bots' probes
for other systems' pages, such as `/wp-login.php` and `/.env`, are left out of the log.

The plugin's redirects and not-found collections gain columns (hits, last hit, gone; came from,
ignored). Run `nextly migrate:create` and then `nextly migrate` after upgrading to add them.
