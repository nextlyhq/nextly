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

The media library now keeps a record of which media items each document uses, and reads its folder
counts and folder contents from the database.

- A new core table, `nextly_media_usage`, holds one row per media item used by one field of one
  document, in one language (`media_id`, `subject_kind`, `subject_slug`, `document_id`,
  `field_path`, `locale`). It is additive, created by `nextly migrate` like every core table. Run
  `nextly migrate` to create it on an existing site.
- The record is rewritten in the same transaction as every write that changes a collection entry,
  a Single or an email template: create, update, publish and unpublish, the transaction API and
  batch writes. It covers upload fields (one id or a list), images, videos and galleries in rich
  text (by their address), block documents (`assets.mediaIds`), the addresses any other JSON value
  holds under `src` or `url`, and these inside groups, repeaters and field groups. An address that
  names an item by its media route (`/api/media/<id>/raw`, as a Page Builder font face does) is read
  as that item, and one made absolute against the site (`https://site/uploads/a.png`) by its path. A
  value every language shares is recorded with an empty `locale`; a translated one, under its
  language, including a language removed in Settings, whose content is kept. A working draft held beside published content is recorded once it is
  published. A deleted document's rows, every row of a deleted collection or Single, and a deleted
  media item's rows go with them.
- `nextly media reindex-usage` rebuilds the record from the stored content. Run it once after
  `nextly migrate`: until then, content written before this release is not in the record, and the
  counts below say so (`usageRecorded: false`). A new site's record is complete from the start. Run it
  from the project's own folder: from another one, or with a `--config` outside the project, it
  rebuilds nothing and ends with `MEDIA_REINDEX_OUTSIDE_PROJECT`, as `media orphans --apply` does.
- `GET /api/media/counts` answers every folder's item count, the items in no folder, and the counts
  of all items, images missing alt text and items nothing uses, in one query. An item a user's
  avatar, the email brand's logo or the site's logos keep is in use: these are stored as the item's
  address, outside any document, and the count and the `unused` view ask them directly.
- The media list takes `view=missing-alt` or `view=unused`.
- The media list's and a folder's `type` filter now narrows to the kind each file is shown as:
  `document` is a PDF, an office file or any text, and `other` is what no kind names. Before, both
  matched nothing, as each kind was read as the first part of the MIME type.
- A folder's contents (`GET /api/media/folders/:id/contents` and `/folders/root/contents`) now
  come a page at a time, sorted and filtered in the database: `page`, `limit` (at most 100),
  `search`, `type`, `sortBy` and `sortOrder`, as the media list takes them. The response adds
  `meta` (`total`, `page`, `limit`, `totalPages`), and `files` holds that page, 24 items unless a
  `limit` is given. A caller that counted `files` for a folder's size reads `meta.total` instead.
- A plugin that writes content through the Direct API is recorded like any writer. One that writes
  media ids into tables of its own is not.
