---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
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
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
---

Apply hook edits without restarting the dev server

Editing a hook in `nextly.config.ts` had no effect until the process restarted,
and deleting one left it firing. A config reload re-read the file but the
registry kept the function objects registered at boot, so the hook that ran was
always the one from startup.

Collection and single hooks are now rebuilt from the reloaded config. Clearing
them is safe because the registry records who registered each handler: a
reload replaces only what it can rebuild, and leaves alone both a plugin's hooks
(the form builder registers directly on `forms`, and plugins do not re-run on a
config reload) and any registered imperatively through `registerHook()` (nothing
re-runs those at all). Unregistering is likewise scoped to the caller's own
registrations, so a plugin removing a handler it shares with the config no
longer removes the config's instead.

A save that changes a hook and a schema at once is handled as one unit: the new
handlers are published only once the schema they were written against has landed,
so a request served while the reload is still running never sees a hook reaching
for a column that is not there yet, and a refused schema change leaves the
previous handlers in place. Replacing them also keeps their position, so a config
save no longer reorders a chain it is not changing. Switching a plugin to `enabled: false`
now stops everything it contributed -- the hooks its collections and singles
declared, and the ones it registered itself, which are suspended rather than
dropped so re-enabling it in the same session brings them straight back. Deleting
or renaming a collection stops its hooks too: a removed entity's table is kept until `nextly prune`, so it stayed
addressable and went on running hooks its config no longer declared.

Registering straight into the registry that `getHookRegistry()` hands out now
marks the handler as the app's, matching `registerHook()`. Only the registrars
that read the config claim ownership a reload may replace, so a handler nothing
can rebuild is never removed by one.
