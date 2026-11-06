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

`nextly plugins install` now records the columns, indexes, foreign keys and checks a plugin's
migrations add to another owner's table as that plugin's, as `nextly migrate` does. An install
used to record only the plugin's own tables, so until the next `nextly migrate` nothing said whose
those elements were, and an install run again after one that stopped between a migration's record
and its ownership left them unrecorded as well. The install now records them on every run, the
repeat after a stop included.

A full `nextly plugins uninstall` no longer refuses over a relationship field the plugin's own
transform put inside another owner's group or repeater. That field goes with the plugin, as a
top-level field it added does. A field of the other owner's own in the same group still refuses
the uninstall, and so does one the uninstall cannot match to the plugin.
