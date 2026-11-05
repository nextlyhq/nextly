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

`nextly migrate` and every other migration command now ignore the `.sql` files an earlier Schema Builder wrote into your migrations folder, where `nextly migrate` used to refuse them, or, at a development start, apply them as written.

A file is ignored only when it carries the whole signature the Builder left: a name like `1730000000000_create_posts.sql` (13 digits, then `create`, `update`, `i18n`, `status` or `drop`, then the entity's name), no snapshot beside it in `meta/`, none of the lines `migrate:create` writes (`-- UP`, `-- DOWN`, `-- Collections:` and the other entity headers), and statements that change only that entity's own tables, or its own registry row. Such a file is never applied, listed, counted or compared, and its ledger rows play no part in any check.

- `nextly migrate`, the boot migrate step, `nextly migrate --dry-run`, `migrate:check` and `migrate:status` name each ignored file with "ignored: written by an earlier Schema Builder". It is information: the exit code is what it would be without the file. `migrate:status --json` lists them in a new `ignoredOldBuilderFiles` field and writes the line to standard error, so standard output holds only the document.
- A delete the Builder wrote for several collections, `<13 digits>_drop_<N>_collections_<hash>.sql`, is ignored only when every statement is a `DROP TABLE` of a Builder collection's table; the same holds for a single collection's, a field group's and the user-field table's drop files.
- The first `nextly migrate` of this release records, for each ignored file a ledger row names, that the row is an old Builder file's, with the file's checksum. A file edited later within the signature has its new checksum recorded.
- If such a marked file later stops carrying the signature, every command refuses before changing anything: with exit code 2 (`MIGRATION_TAMPERED`) where its content changed, or with the new code `OLD_BUILDER_FILE_SNAPSHOT_ADDED` where a snapshot now stands beside it. Put the file back, remove the snapshot, delete the file, or accept it with `nextly migrate:resolve --applied <file>`, which withdraws the record.
- A file with the Builder's name and no snapshot that does not carry the rest of the signature, for example one that changes another collection's table or a table nothing declares, is still refused, with `BUILDER_MIGRATION_SNAPSHOT_MISSING`: the refusal now names the part of the signature it lacks, and the fix is to replace it with the migration `nextly migrate:create` writes, or to delete it.

**Before upgrading:**

- Keep the old Builder files in your migrations folder until the first `nextly migrate` of this release has run: that run records which ledger rows are theirs. You can delete them after it.
- `nextly migrate --dry-run` or `nextly migrate:check` names any file with a Builder name that is not recognised as an earlier Builder's, with the part of the signature it lacks. Without a snapshot it is refused, as before; replace it with the migration `nextly migrate:create` writes, or delete it.
