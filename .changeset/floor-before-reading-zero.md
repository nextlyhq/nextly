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

Retention no longer reads a sub-millisecond window as a request to delete everything.

A retention window is a whole number of milliseconds, so a fractional value is
rounded down. That rounding ran AFTER the check for zero, which meant any window
under one millisecond arrived as a window rather than as the zero it becomes:
\`0.5\` was not zero when the check ran, and was zero by the time it was used.

On the audit trails a window of zero is treated as a mistake and replaced by the
default, because erasing the record of who did what on a typo is not
recoverable. That protection was reachable only by writing exactly zero. A value
that rounded to zero skipped it and produced a cutoff of the current moment,
which removes the entire trail on the next pass.

The rounding now happens before the reading, so a window is judged as the value
it actually resolves to. A delivery ledger set to a fraction still keeps
nothing, which is that trail's own position on zero and unchanged.
