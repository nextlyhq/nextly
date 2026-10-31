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

**Removing the image sizes an earlier release stored.** Items uploaded before image sizes were removed still name their size files in the media table's `sizes` column, and the size definitions are still in the `image_sizes` table. This release adds the way to remove them, in two steps, and nothing is removed until you run them. Until then your site keeps working, and startup names what is left.

- `nextly media remove-sizes` lists, as a dry run that changes nothing, every size file items name, which it would remove and which it would keep. `nextly media remove-sizes --apply` **deletes those files from your media storage** and then clears each item's `sizes`, item by item. It never deletes an original or a thumbnail: an item whose thumbnail is one of its sizes keeps that file, as does any size file another item uses. If the storage refuses a file, that item keeps its `sizes`, the item and the file are named, and the command exits non-zero; running it again picks up where it stopped.
- `nextly migrate` then **drops the `media.sizes` column and the `image_sizes` table, with its rows** (the size definitions). It does so only when no item names a size file; until then it keeps both, says how many items still do, and runs the rest of the migration. `nextly migrate --dry-run` names what it would drop. A migration run at startup never drops them.
- A new install has neither the column nor the table, and `CORE_TABLE_NAMES` (from `nextly/schemas`) no longer lists `image_sizes`.

**Back up first, and restore both together.** Before `--apply`, back up the database (`pg_dump`, `mysqldump`, or a copy of the SQLite file) and the media storage folder or bucket (for example `cp -R public/uploads …` or `aws s3 sync s3://your-bucket …`), at the same time. To undo the removal, restore the database dump and copy the files back to the same paths; restoring one without the other leaves records and files that disagree. The media storage guide has each step: back up, dry run, run, check, restore.
