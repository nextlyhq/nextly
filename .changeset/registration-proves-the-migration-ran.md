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

`nextly migrate` no longer records an entity as applied because a snapshot
mentions it. Registration reads every `*.snapshot.json` in the migrations
directory and inserts each missing entity with `migrationStatus: "applied"` —
so a `--step N` run exposed entities belonging to migrations it never reached
as applied, while their tables may not exist. Nothing downstream could correct
that: the pending sweep beside it only looks at rows still marked pending, and
those rows were not.

Registration now takes the evidence for the claim. A snapshot is read only when
its migration is recorded applied in `nextly_schema_events`, through the same
`isFileApplied` query the migrate command already uses to decide what is
outstanding — so what registers and what executes read one source instead of
two that can disagree.

The pairing is by migration GROUP: `runFileMigrations` records `0001_x.sql`
whether it executed `0001_x.sql` or `0001_x.mysql.sql`, and the snapshot beside
it is `meta/0001_x.snapshot.json`.

Omitting the check keeps the previous behaviour, which the development boot path
relies on deliberately: it applies every pending migration immediately before
registering, so it has no unapplied snapshot to skip.
