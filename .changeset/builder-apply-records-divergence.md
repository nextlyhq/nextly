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
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

Saving a field group in the Schema Builder no longer reports success when the change was only half made.

The save changes the database tables first and then records what it did. If that recording step failed, the failure was written to the server console and the response still said the schema had been applied. The tables held the new shape, the stored definition still described the old one, and nothing marked the field group as needing repair.

That was worse than it sounds, because the version number was deliberately left where it was. An editor already open would therefore pass its staleness check and plan its next change from a shape the database no longer had — the exact retry the `diverged` state exists to refuse, arriving through the one path that never marked it.

A failed recording is now recorded. The field group is marked `diverged`, and the response says which of three things actually happened, because the operator's next step differs for each: the failure was marked, so reconcile and do not retry; the record turned out to have moved on, so reload before doing anything, since the change was probably saved and the field group may also have been deleted; or nothing could be recorded at all, so the server log is the only trace.

One case that used to be reported as a failure now correctly reports success. MySQL has no `RETURNING`, so a write is an update followed by a read, and a read that fails after the update has already committed used to be treated as though nothing was written. The save now re-reads the row and reports success when it already carries the change.
