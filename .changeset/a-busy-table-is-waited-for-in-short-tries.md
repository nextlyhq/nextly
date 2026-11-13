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

A busy table no longer waits without end. When `nextly migrate` or `nextly migrate:down` runs a migration file in one transaction on PostgreSQL or SQLite and a statement waits for a table another database session is using, each try now ends after about 5 seconds of waiting for locks, the run pauses (1, 2, 4, 8, then 15 seconds) and tries again, and after about 90 seconds in all it stops with `TABLE_BUSY` (exit 1): "table busy, nothing changed", the table, the tries made, the session holding it (never its query text) and the next step. A try that ran a statement which may not be sent again (`setval`, an index built `CONCURRENTLY`, a trigger or a function of the site's own) stops after one try. `--lock-timeout` and `--lock-timeout-total`, or `NEXTLY_LOCK_TIMEOUT` and `NEXTLY_LOCK_TIMEOUT_TOTAL`, change the bounds (whole seconds: one try 1 to 3600, the total from one try to 86400). A one try set longer than the default total, with no total given, raises the total to match; an explicit total below the one try is refused. These bound the wait for a busy table, not the wait for the schema lock.

Plugin migration modules, `migrate:fresh`, `prune`, `db:sync`, the development push and start, and the `upgrade` steps now wait for a table another session holds in short tries, as `nextly migrate` does, instead of waiting without a bound. Plugin modules run in tries through `nextly migrate`, the boot step, `plugins install`, `plugins uninstall` and `migrate:down --plugin`. `migrate:fresh`'s drops, `prune`'s statements, the development start's table creation and the `upgrade` steps run one statement per try on one connection. The schema pipeline's apply runs in tries for `db:sync`, the development push and the Builder's apply, asking its questions once. A run that stops on a busy table names the table and what holds it, and changes nothing more.

A Schema Builder save of a collection now waits for a table another session is using, as `nextly migrate` does: in short tries, within the bounds `NEXTLY_LOCK_TIMEOUT` and `NEXTLY_LOCK_TIMEOUT_TOTAL` set, then it stops as "table busy, nothing changed", naming the table and what holds it. A save whose tries ran out on MySQL now withdraws its files and puts its definition back, as a save that changed nothing does.
