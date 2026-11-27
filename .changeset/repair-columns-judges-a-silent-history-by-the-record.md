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

`nextly repair-columns` no longer converts correct columns where no applied snapshot says what was last migrated. It used to fall back to each entity's registry row, which a start with `NODE_ENV` unset (a seed script, for example) rewrites from its own configuration while leaving it marked applied, and `--apply` then converted the columns towards that configuration, as safe, with nothing asked.

- Where the database records that snapshots were written for applied migrations `nextly migrate:create` wrote (its registry record, kept since 0.0.2-alpha.75), and none that records the entities is left in `meta/`, the run stops with `MISSING_SNAPSHOT`, dry run included. Restore `meta/` from version control, or, where it was never committed, write and apply a migration with the configuration as it was at the last `nextly migrate`.
- A project whose snapshots predate the record of entities (before 0.0.2-alpha.73) is judged by the registry rows the record kept at its first `nextly migrate`: a row that differs from them is not trusted, and its entity's columns are reported as pending a migration rather than converted.
- Where no record is kept yet, the run goes on and says once, on standard error, that the registry rows stand in. Run `nextly migrate` first.
- Where the newest applied snapshot records no entities and an older one does (a migration written with an earlier release after one written with a later one), the run stops with the new code `SNAPSHOT_WITHOUT_ENTITIES`, naming both migrations and the way out.

Compatibility: a project whose meta folder lost applied snapshots, which this command ran on before, now stops; so does a history with an earlier release's snapshot after a later release's.
