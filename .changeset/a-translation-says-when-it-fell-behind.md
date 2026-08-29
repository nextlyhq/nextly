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

A translation now says when its source has moved on since it was written.

The timestamp each language already records is finally read. A language whose
source was edited after it was translated is marked as needing review, and stays
exactly what it was otherwise -- still translated, and still published if it was
published. A translation that has fallen behind is not a demotion; it is a
second fact about a language that is still live, and treating it as a state
would take a working translation off the screen it belongs on.

Reported only where it can be established. The signal depends on a column older
translation tables do not carry, and whether a given one carries it is now
checked against the database rather than assumed from configuration. A site that
has not run `nextly migrate` yet sees nothing new instead of an error, and every
language there reports as unknown -- never as up to date, because a translation
the system cannot vouch for must not be described as current.

Nothing here asks a person to keep the signal honest. It is derived from when
each language was last written, so re-saving a translation clears it as a
consequence of the save, and no flag is left behind for someone to remember to
untick.
