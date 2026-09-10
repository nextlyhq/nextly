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
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

An import, a job and a migration appear in the activity trail.

They recorded nothing, and the reason turned out to be a defect rather than a
constraint. A container reports an absent registration two ways — by throwing,
and by answering `undefined` — and only the first was handled, so the second
failed on a property access. That turned "no dashboard service registered" into
a FAILED CONTENT WRITE, which is the outcome the surrounding catch exists to
prevent.

With the guard complete, a write that names no initiating user is recorded as a
system write. It takes the reserved identifier the rest of the codebase already
uses for itself, and a seed arriving as a user holding that same reserved id is
the same write in a different shape, so both are filed as system rather than one
being attributed to an account nobody owns.

An ABSENT actor is still not recorded, and it is a different thing: it means
the caller named nobody, so there is no identity to attribute the write to.
