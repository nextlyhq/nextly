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
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-mcp": patch
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

`nextly migrate` now brings the data an earlier release stored up to date, which `nextly upgrade` used to do. Once its migrations have applied it hashes passwords stored before this release, removes passwords kept in version history, and converts roles holding a retired `manage-` permission, under the schema lock. A deploy needs one command for the database: `nextly migrate`.

These steps rewrite stored values, so `nextly migrate` needs a backup confirmed when one of them has work: pass `--backup-confirmed`, or answer yes when it asks at a terminal. With no terminal and no flag it stops with `DATA_STEPS_BACKUP_NOT_CONFIRMED` before it applies anything, pending migrations included; a no at the prompt stops it with `DATA_STEPS_BACKUP_DECLINED`. The flag is ignored when there is nothing to change, so a deploy script can always pass it. `nextly migrate --dry-run` lists each step with work and its count.

New command: `nextly i18n:convert-zoned-dates` converts the translated date columns an earlier release made with a time zone on PostgreSQL. It is the conversion `nextly upgrade` ran, unchanged, as a command of its own because it must run after the deploy, once the release serves every instance. It takes `--backup-confirmed`, `--dry-run` and `--force-unlock`. A start and `nextly migrate` name it for each such column.

**Compatibility: `nextly upgrade` no longer changes stored data.** Run without `--reconcile-core` it opens no database, changes nothing and exits 1 with the new code `UPGRADE_WORK_MOVED`, naming `nextly migrate` and `nextly i18n:convert-zoned-dates`, so a deploy script that still calls it fails there instead of passing with the work undone: replace it with `nextly migrate`. Its `--confirm-backed-up` and `-f, --force` flags are still accepted and no longer do anything. `nextly upgrade --reconcile-core` is unchanged. `UPGRADE_CANCELLED` and `UPGRADE_BACKUP_NOT_CONFIRMED` are retired: they keep their meaning and their pages, and no command ends with them any more, so a script that matched them should match the `DATA_STEPS_` codes. The start warning for a retired manage permission now names `nextly migrate`.
