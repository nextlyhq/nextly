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

The API Keys screen no longer offers controls the endpoint behind them will
refuse.

The list route was widened to admit `read-api-keys`, because the endpoint
accepts that grant — but the page still rendered Create unconditionally and
every active row still offered Edit and Revoke. A reader who could only view
keys was shown three controls, each leading to a route or request that turns
them away.

Each control is now gated on the grants its own operation needs, and the row
itself follows the same gate as the Edit item rather than staying clickable
into a route that refuses. The create route accepts what the endpoint accepts
instead of the narrower grant alone.

The rule behind all of them is declared once, in the package that enforces it:
`nextly/config` exports the API-key policy, the endpoints authorise from it, and
the admin's route guards and controls derive their grant slugs from the same
declaration through `permissionSlug`. Writing that rule twice is what let the
list route demand `update-api-keys` while the endpoint accepted `read-api-keys`.
The table's two gates are required props rather than defaulted, so a call site
cannot omit them and silently offer everything.
