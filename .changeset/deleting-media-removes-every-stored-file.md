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

Deleting a media item now removes every file stored for it: the original, the thumbnail made at upload, and every image size, on local disk, S3, Vercel Blob and UploadThing.

**Privacy note.** Until this release, deleting a media item left its upload-time thumbnail stored, on local disk under `public/uploads` and on S3 and Vercel Blob, where it stayed publicly reachable at its old URL. (UploadThing was not affected.) To find those thumbnails, run `npx nextly media orphans`: it lists them by stored path and changes nothing, and you remove them by hand from the folder, bucket or dashboard they are in. Run it again with `--apply` to have it remove the ones whose place shows they are media's: it asks about each batch of files just before removing it, keeps any an item has come to refer to, and stops if it cannot check. On S3 it matches keys as written, so `/media/...` or `media//...` keys are never taken for `media/...` ones. Run it from the project's own directory to remove files: with `--cwd` naming another project, `--apply` refuses, since the database settings were read before it. It lists a file as left behind only under a `prefix` the media collection has to itself, one no other collection on any storage shares, contains, sits inside or begins. Without one, as by default, another collection or upload can store a file of the same form in the same place, so it lists what it finds there as files nothing shows are media's, and names any collection that shares media's place: check those with more care. The command looks only under media's prefix as it is now set, so run it before you give media a prefix: the thumbnails earlier deletes left stay where they were, outside it. It looks only at the storage the media collection uses now. If your site used another adapter, bucket or folder before, point the media storage at that one and run the command there too. The command leaves out thumbnails stored in the last hour, which may belong to an upload still in progress: if you deleted, before upgrading, an item uploaded less than an hour before you run it, run it again an hour later. On UploadThing, whose apps can hold other uploaders' files, it lists what it finds by file key and uploaded name: remove the ones that are yours from the UploadThing dashboard. Run it again after a delete whose log names a file it could not remove, or whose process stopped before it finished.

- Deleting a folder with its contents removes every file of every item in it and in its subfolders, once their records are gone. It removed none before.
- A file the storage refuses to remove is logged with its path and the media item, so it can be found.
- `@nextlyhq/storage-uploadthing`: a delete UploadThing refuses (an outage, a refused token, a rate limit) now fails, so it is retried and logged like any other, rather than read as done while the file stays stored. A file already gone is still not an error.
- A crop inside a plugin's `ctx.db.transaction` on SQLite removes the sizes it replaced once that transaction commits. They were kept before, stored indefinitely.
- A crop or rotation whose new sizes include `thumbnail` removes the thumbnail made at upload, which nothing refers to any more.
- A crop on SQLite saves its regenerated sizes. It failed before, because the sizes were written as an object the driver cannot store.
- A delete and a crop of the same item at once, or two crops at once, leave no file of the item behind.
- Storage adapters can now list their files (`list()`, optional). `@nextlyhq/storage-s3`, `@nextlyhq/storage-vercel-blob` and `@nextlyhq/storage-uploadthing` implement it; an adapter without it is reported as one that cannot be searched.
