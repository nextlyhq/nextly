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

Every media record now carries a fingerprint of its file: the SHA-256 of the stored bytes, in a new `media.sha256` column with an index (not unique, since two records may share one file). Nothing on screen changes, and the API's media responses keep their shape.

- **New uploads** get it at once, on every upload path (the admin, the Direct API, bulk uploads and the server action). For an SVG it is the hash of the sanitized file as stored, not of the file as sent. Replacing a file gives the record the new file's fingerprint.
- **Existing media** get theirs from a background job, `nextly:media-hash-backfill`, which every jobs run (`/api/jobs/run`) picks up on its own. It uses at most half of each run's time, keeps its place between runs, and carries on after a restart. A file missing from storage is skipped and named in its report, which it keeps under the `nextly_meta` key `media.hash.backfill` and logs once when it finishes. A read that fails (storage or the database briefly unavailable) is tried again on the next run, and a file is given up on, and named, only after three runs in a row. A storage that cannot read files back fails the job rather than naming every file. Once finished it reads nothing more, so a missing file is not read again on every run.
- **Webhooks**: the `media.uploaded`, `media.updated` and `media.deleted` payloads gain `sha256`, and so do the media records the `nextly/actions` server actions return.

**Upgrading**: run `nextly migrate` (or start the app in development) to add the column and its index to an existing database. Nothing stored is changed or removed: existing records keep a null fingerprint until the job reaches them. On a large library the job reads every stored file once, a little each jobs run, so expect some extra storage reads (and, for S3-compatible storage, read requests) until it finishes.
