---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/admin": patch
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"nextly": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/ui": patch
---

`nextly db:sync` no longer proposes deleting collections you built in the Schema Builder.

Collections reach the database two ways: written in `nextly.config.ts`, or created through the Schema Builder, which stores them in the database only. `db:sync` worked out the intended schema from the config file alone, so Schema Builder collections were invisible to it. On SQLite and MySQL the comparison covers the whole database, so those collections were treated as leftovers and lined up to be dropped. The dev server already merged them back in; `db:sync` and the dev server now share one implementation of that rule, so they cannot disagree again. If the registry cannot be read, the sync continues with what the config describes and says plainly that Schema Builder collections may be flagged.

Indexes are also no longer blocked from being dropped. The safety check worked out which table an index belonged to by reading its name, using a convention Nextly does not follow, so it never matched and every index change was refused with a warning. It now asks the database which table owns the index, which is also correct for index names you chose yourself.
