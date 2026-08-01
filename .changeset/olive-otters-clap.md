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
