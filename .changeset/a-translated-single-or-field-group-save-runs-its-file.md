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

In development, a Schema Builder save of a translated Single or field group now runs its own migration file instead of the dialog's push. This includes a save that turns translation on or off, makes a field translated or shared, or renames or removes a translated field. A save that makes a Required or Unique field shared still uses the push. Before the file runs, the save compares the translations table with what the migration history records of it, and checks that the main table holds none of the translated columns. If either differs, the save is refused with the same drift error `nextly migrate` gives, and nothing changes. A translated rename that an earlier save left half done is now refused this way too, with migrate's recovery steps, instead of being finished. The save also creates the translations archive first on a database where `nextly migrate` has not run, so turning translation off no longer fails there. A field that leaves translation keeps its default language's value in the archive as well as its other languages, as a `nextly migrate:create` file does. A drop listed in the schema dialog's review is applied when the review is confirmed, in the save that turns translation on as in any other.
