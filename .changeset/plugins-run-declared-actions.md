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

A plugin's declared row and bulk actions now run (experimental). A plugin route an action runs is reachable only as that action: before its handler runs, every request to it is refused unless it names the action and its rows, the caller holds the action's own permission, and the action's rule holds on every row as the caller reads it, so a bulk request with any row failing is refused whole. A row the caller may not read answers as a missing one. The entry list shows a collection's declared row actions in each row's menu, on the rows their rule holds for; one runs the plugin's route with the admin's CSRF token, or opens the plugin's component with the row. An action's `run` must now name a route that answers a write (`POST`, `PUT`, `PATCH` or `DELETE`), whose path takes no parameters, and that is neither public nor a route for a plugin's own kind of signed-in person: a declaration naming any other refuses to start, and `run.method` no longer accepts `GET`. To keep such an action, declare a non-public write route at a literal path for it, and read the rows from the request body. Adds the `ACTION_NOT_AVAILABLE` (403) error code.
