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

`nextly migrate` no longer applies a migration file that deletes data without consent. Before it changes anything, it reads each pending file statement by statement and names what it would delete: a dropped table or column, rows a `DELETE`, `TRUNCATE` or MySQL `REPLACE INTO` removes, the tables an `ON DELETE CASCADE` reaches from the live foreign keys, a SQLite table rebuild that leaves a column or rows behind, and a column type change. On a terminal it lists every file with what it deletes and asks once; elsewhere it refuses, naming the consent that covers it: `--accept-data-loss` (every deletion) or `--accept-data-loss=posts,pages.summary` (only those), or `NEXTLY_ACCEPT_DATA_LOSS` with the same values. A statement it cannot read, or a cascade whose foreign keys it cannot read, needs the consent without targets.

`migrate:down` names each deletion its down sections make in the same way, so a consent naming tables now covers them. `migrate:check` reports such a file as `DESTRUCTIVE`, naming what its UP or DOWN deletes, and still passes. `nextly migrate --dry-run` and `migrate:down --dry-run` list each deletion and the consent a real run needs.

**Compatibility:** a pending file that deletes data, already committed in a project, now stops `nextly migrate` until consent is given. The boot migrate step reads only `NEXTLY_ACCEPT_DATA_LOSS`; without it the step logs the file and the consent it needs, applies nothing, and the site keeps serving. `NEXTLY_ALLOW_CORE_DESTRUCTIVE` still covers only Nextly's own tables, never an app file's deletion. A column type change is refused until the consent names the column.

**Upgrading:** before deploying, run `nextly migrate:check` or `nextly migrate --dry-run` to see which pending files delete data, and set `NEXTLY_ACCEPT_DATA_LOSS` (or pass `--accept-data-loss`) naming what each may delete.
