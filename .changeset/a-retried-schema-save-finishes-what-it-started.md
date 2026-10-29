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

A Schema Builder change that MySQL refused part-way is finished by saving it again:

- The schema pipeline keys a relationship the change adds even when the earlier attempt already
  added its column, so the retry no longer leaves it without its foreign key. A relationship the
  collection already records is planned no new key, and one the change renames keeps what its old
  column had: no key where it had none.
- A field made translated over a column the translations table already has takes that column as
  its own only when it holds every value the field allows: the same type, a length or precision at
  least as large, and empty values allowed. Otherwise the change is refused before anything
  changes, naming the column, both definitions and how to go on, since the column may hold the
  field's values from the change that did not finish.
- A field the change made translated whose values the earlier attempt already moved is no longer
  refused on the retry because its length or precision changed meanwhile.

The same check applies where a config sync (`nextly db:sync`, its `--watch` loop, `nextly migrate`
and a config reload under `next dev`) takes a translations column already there as a field's own,
for the fields that run newly translates, judged against the fields recorded before the run.

A config sync now widens a translated field's column when the config raises its length or
precision, keeping the column's other properties; a column already wide enough is left as it is.
A column that cannot hold the field and cannot be widened to it, such as one of another type, is
never converted: the run that changes the field is refused, and later runs report it as a warning.

The Schema Builder now shows why a schema change was refused, naming each field and its reason,
instead of only "Validation failed.".
