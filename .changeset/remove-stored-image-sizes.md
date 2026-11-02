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

**Removing the image sizes an earlier release stored.** Items uploaded before image sizes were removed still name their size files in the media table's `sizes` column, and the size definitions are still in the `image_sizes` table. This release adds the way to remove them, in two steps run after it is deployed, and nothing is removed until you run them. Until then your site keeps working, and startup names what is left. Where the note on image sizes says nothing stored is removed, read it as nothing removed automatically: neither that change nor this one removes anything stored, and these commands remove it only when you run them.

- `nextly media remove-sizes` lists, as a dry run that changes nothing, every size file items name, which it would remove and which it would keep. `nextly media remove-sizes --apply` **deletes those files from your media storage** and then clears each item's `sizes`, item by item. It never deletes an original or a thumbnail: an item whose thumbnail is one of its sizes keeps that file, as does any size file another item uses, checked again just before each removal so an upload made meanwhile keeps its file. An item is left as it is, named, and the command exits non-zero when the storage fails to delete one of its files with anything but an error saying that file is not there, when its files are on another storage than the one configured now (a URL relative to the site counts as local disk), when a size is recorded by its path alone (which shows no storage, so it is left for you to remove by hand), or when that check cannot be made; running it again picks up where it stopped.
- `nextly media remove-sizes --apply --drop` then **drops the `image_sizes` table, with its rows (the size definitions), and the `media.sizes` column**. It drops nothing while any item still names a size file or another table has a foreign key to `image_sizes` (each key is named, and the drop never cascades), and drops each only when the database shows it is what image sizes left; a table of that name that is not shown to be Nextly's is kept and named. `nextly migrate` never drops either, from the command line or at startup.
- A new install has neither the column nor the table, `CORE_TABLE_NAMES` (from `nextly/schemas`) no longer lists `image_sizes`, and the `media` table exported from `nextly/schemas` no longer declares `sizes`. The name `sizes` is reserved on the media table: a column an app or a plugin contributes under it is refused.

**Back up first, and restore both together.** Before `--apply`, back up the database (`pg_dump`, `mysqldump`, or a copy of the SQLite file) and the media storage folder or bucket (for example `cp -R public/uploads …` or `aws s3 sync s3://your-bucket …`), at the same time. To undo the removal, restore the database dump and copy the files back to the same paths; restoring one without the other leaves records and files that disagree. The media storage guide has each step: deploy, dry run, back up, remove, drop, check, restore.
