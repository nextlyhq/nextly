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
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
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

A Single save sent with `_overwrite: true` is no longer written over another
save that landed after its values were checked. Checked only before its
transaction, such a save could replace what another writer stored in between
with a value judged against the Single as it stood before, so a rule such as
"only a manager may change the page's code" never saw the change it was
undoing.

The save now notes the Single's version before its values are checked, and
compares it under the row lock, as a `_rev` is compared. If it moved, the
values are checked again against the Single as it is now, and written in a
new attempt. After three attempts the save is refused with a 409 and nothing
saved. Only the check and the write run again: the hooks before them run once,
and nothing after the commit runs until one attempt commits. A save of another
language, which leaves this one as it was, causes no retry. Checks never run
inside the save's transaction, so a field type's validator that reads through
the pool doesn't wait on the connection the transaction holds. A save that
carries `_rev` is unchanged: its version check refuses that race already.
