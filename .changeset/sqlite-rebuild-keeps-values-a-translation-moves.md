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

A `nextly migrate:create` run that turns translation on for a collection or Single and, in the same run, changes its table in a way SQLite applies by rebuilding it (a field made required, for one) no longer loses that entity's translated values on SQLite. The rebuild now keeps the columns whose values the run's translation file moves into the translations table, and that file moves them and then drops the columns, as on PostgreSQL and MySQL. Before, the rebuild dropped them first and the translation file then failed. `migrate:create` now refuses, before writing anything, any plan in which a file deletes a table or column whose values a later file of the same run reads.

The form builder keeps the fields that describe a submission once for every language rather than per language: a submission's spam reason, notes, IP address, user agent, page, editor and title, and every text field of its notification sends, resend requests and uploads. They describe the record, not content written in a language. An installation upgrading from a release before per-language storage keeps them where they are. An installation that has run the previous alpha holds them per language: its next `nextly migrate:create` writes the move back, which keeps each value as the field's shared value and copies any other language's value to the localization archive, as when any field stops being translated.

A submission's `form` column stays nullable. The form builder refuses a submission created without its form, or a change that empties it, when it is written. An installation from an earlier release that holds a submission without a form can still upgrade and still handle that submission.
