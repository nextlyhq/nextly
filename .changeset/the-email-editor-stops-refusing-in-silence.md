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
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
"nextly": patch
"@nextlyhq/plugin-form-builder": patch
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
---

Fixes four problems in the email template editor.

Save no longer appears to do nothing. If a declared variable was missing its
name and you had closed Settings, saving was refused with no message anywhere,
because the only place that message appears is inside Settings. Saving now
reopens the panel that holds whatever needs fixing.

On a phone the editor's action bar now wraps instead of pushing Save off the
side of the screen, and the variable strip above the code can no longer grow
until there is no room left to write in.

And the settings menu, while it steps aside during editing, no longer leaves its
links reachable by keyboard — tabbing could previously carry you out of the
editor through a menu you could not see.
