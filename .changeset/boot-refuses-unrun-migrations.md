---
"nextly": patch
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
"create-nextly-app": patch
---

Refuse to start when boot migrations did not run. With `db.runMigrationsOnBoot`,
an instance that could not take the migrate lock before its wait deadline used
to log `Boot migrations complete (0 applied)` and serve traffic — `applied` is 0
there and 0 on an up-to-date database, so nothing distinguished them. On a
rolling deploy that is the second replica serving against a schema it never
migrated. It now fails startup, which an orchestrator retries once the other
instance finishes; a genuinely stale lock is cleared with
`nextly migrate --force-unlock`.

`withMigrateLock` reports whether its body ran instead of returning `undefined`
for both "returned nothing" and "never ran", so every caller has to decide. Its
wait-timeout message said "proceeding without it" while returning without
running the migrations, and now says they were skipped.
