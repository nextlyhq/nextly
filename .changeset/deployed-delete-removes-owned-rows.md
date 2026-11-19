---
"create-nextly-app": patch
"nextly": patch
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
---

`nextly migrate` now removes in a deployed database what deleting a collection, Single or field
group removes in development. The migration file still holds only the drops of the entity's
tables. Once the file is recorded applied, the same run removes the rows other tables hold for the
entity: its field-group values (nested ones too), its archived translations and the record of where
its translations came from, its translation transition record, and then its registry row with its
autosaves, version pins, "seen" markers, dashboard pins and media usage. Each kind of row is
removed on its own, the registry row last, so a run that stops part-way is finished by the next
`nextly migrate`, even with nothing pending, without running any drop again.

A run that cannot remove what a dropped entity owned now fails, naming the entity and what it
still holds, instead of only warning. A production start that applies migrations reports it and
keeps starting; the next run removes what remains.

The data-loss consent listing now also names a dropped field group's nested values and archived
translations, covered by naming its table.

The Schema Builder's delete of a collection, Single or field group in development removes these
rows through the same code, in its one transaction, before its drops, as before.

**Compatibility:** migrations written by an earlier release's delete keep leaving the rows that
release left; only the run that removes the entity's registry row removes them, so an entity whose
registry row an earlier run already removed keeps them.
