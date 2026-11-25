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

A project's migration history now records which names its field groups are kept under, and every migration command follows it. After `nextly migrate:field-groups --apply` moves a site's field groups to the current names, run `nextly migrate:create --field-group-names=current` once. It writes a migration with no statement whose snapshot is the history under the current names, and every later `migrate:create`, `migrate:check`, `migrate:baseline` and Schema Builder save plans against `fg_<slug>` tables instead of dropping them and creating `comp_<slug>` twins. `nextly migrate` records that migration on a database whose field groups moved and refuses it, naming the storage migration, on one that has not. A moved database behind a history that hasn't moved is refused by name instead of reported as missing every `comp_` table, and a plain `migrate:create` or Builder save across the two namings is refused before it writes anything.

A snapshot on the current names is written as version 2. Older Nextly CLIs refuse a snapshot version they don't know, so they stop with "upgrade your CLI" rather than read such a history as legacy. Upgrade the CLI in every environment before moving a project's history. Snapshots on the legacy names are written exactly as before.

`nextly migrate` and a production start's migrations also read each field group's stored table when they check translation columns, write a Schema Builder group's registry row, and compile a column the app or a plugin contributes to a group. The Schema Builder's address check names a new group's table under the site's names, as the create does.

When `migrate:create` would drop a removed field group, it now finds what still depends on its `fg_<slug>` table on a history on the current names: an app's foreign key, a plugin's column or index, or a key into its translations table. It refuses the drop by name, as it does on legacy names.

A history an earlier release wrote after a site's field groups moved is followed where it can be. A snapshot that keeps field groups under the current names without recording it is read as on the current names, and the next migration plans against the `fg_<slug>` tables instead of dropping them. Two cases are refused instead, each pointing to `nextly migrate:baseline`: a snapshot that holds field groups under both namings (`FIELD_GROUP_HISTORY_NAMES_UNRECORDED`), and a field-group table created after the move that still holds `_component_type` while the history records `_field_group_type` (`FIELD_GROUP_TYPE_COLUMN_NOT_RECORDED`).

New projects and new sites start their field groups on the current names (`dynamic_field_groups`, `fg_<slug>`, `_field_group_type`), so they never need the storage migration. That holds for a development start, `nextly db:sync`, `nextly migrate` and a production start that runs its migrations, and for a project made from the blog template. A site an earlier release set up keeps the storage it holds. Its project's first migration is written under the names its database holds, so `migrate:create` reads that database when the project has no migration yet; where it cannot be reached, the current names are written. An empty database of a project that already has migrations is set up on the names its history is on, so a project with a legacy history stays legacy. Where the history's names cannot be told, or its newest snapshot cannot be read, nothing is set up and the start or command names the file.

`nextly migrate:resolve --applied` refuses to record a migration on the current names on a database whose field groups are still on the legacy ones. `nextly migrate:field-groups --down` refuses where the applied history is on the current names, and where a field group was created on them (`FIELD_GROUP_ROLLBACK_REFUSED`), and where which names the history is on cannot be told (`FIELD_GROUP_ROLLBACK_HISTORY_UNREADABLE`). A move back already in flight still finishes.

**A fresh database of a moved project needs one extra step.** Once a project ran `migrate:create --field-group-names=current`, its older migrations are still on the legacy names, so an empty database starts on those. Run `nextly migrate`, which stops at the migration that moves the history (`FIELD_GROUP_STORAGE_NOT_MIGRATED`); then `nextly migrate:field-groups --apply --backup-confirmed`; then `nextly migrate` again, which applies the rest. A development start and `nextly db:sync` set such a database up on the legacy names too. Projects that never moved, and new projects, need no extra step. To give new databases one history on the current names, re-baseline it with `nextly migrate:baseline`.

`nextly db:sync` now moves a field group's values when one of its translated fields is made shared on a site whose field groups are on the current names. Before, on a site moved with `nextly migrate:field-groups`, the values stayed in the group's translations table and the field read as empty. Values already left there are not restored.

On a site on the current names, these also read each field group's stored table: `nextly migrate`'s check of a field's type change, the settling of a Schema Builder save stopped part-way, what is cleared after a deleted field group, the rollback of its deletion, `nextly repair-columns`, `nextly plugins install` and `uninstall`, and the start's warning about a translated unique field with no index.
