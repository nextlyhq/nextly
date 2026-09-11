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

A many-to-many field's junction table now follows the field through its life in the migrations the builder writes.

Adding a many-to-many relationship field has always created its junction table; nothing removed it. A removed field left the table standing with every link in it — unread, and inherited by any field added later under the same name, because the creation runs `CREATE TABLE IF NOT EXISTS`. A renamed field was worse: the rename detector only pairs fields that have a column, so a many-to-many rename fell to the add/drop loops, which created a fresh, empty junction for the new name and left the old one, links and all, orphaned. Dropping a collection dropped its table and its `_locales` companion and left its junctions behind.

Now:

- **Removing** a many-to-many field emits `DROP TABLE IF EXISTS <junction>`, the table resolved by the same rule the creation uses (the author's `junctionTable` name when set, the generated name otherwise). Moving the field to a storage class that has a column does the same, then adds the column.
- **Renaming** a many-to-many field — one removed and one added that point at the same target under the same relation kind — emits `ALTER TABLE <old> RENAME TO <new>`, spelled the same on PostgreSQL, MySQL and SQLite, so the links travel with the name, and then renames every index and constraint whose generated name embedded the old table name (PostgreSQL renames them; MySQL renames the indexes and re-declares the foreign keys under their new names; SQLite rebuilds the indexes and needs nothing for its per-table constraints). Without that, a later field reusing the old field name would find its index and constraint names already taken. A junction the author named keeps its name and emits nothing. More than one such pairing in a single save is refused by name (`MANY_TO_MANY_RENAME_AMBIGUOUS`), as two field-group renames already are: a wrong pairing would hand one field the other's links. Removals and additions that pair with nothing are plain drops and creates.
- The junction lifecycle is decided on the **full** field lists, so a `localized: true` many-to-many — which the column diff of a localized collection never sees — is created, renamed and dropped like any other; and a save that renames a many-to-many and a field group together carries both.
- **Dropping** a collection drops the junctions its own fields own before the companion and the main table. A junction that another collection's field points at this table through is that field's, and stays with it; what should happen to such a field when its target collection is dropped is a separate question, filed for a decision.

`generateDropTableMigration` takes the collection's fields (defaulting to none) so it can name those junctions; the collections delete path passes them.
