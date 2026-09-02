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

Every storage adapter can read a stored file back as bytes. The contract has
declared `read` as an optional member for some time and only the local adapter
supplied it, so a caller reaching for it against S3, Vercel Blob or UploadThing
got `undefined` and fell through whatever branch followed — a capability that
reads as present and behaves as absent.

The three remaining adapters implement it now. S3 reads through its own SDK; the
two URL-addressed services fetch the address their service issued, since a
derived URL is a guess at a string another system owns.

A missing key answers `null`, which is an ordinary fact about the store. A
transport failure does NOT: a dropped connection to a file whose lookup just
succeeded is reported as an error rather than as absence, because folding the
two together invites a caller to treat a live file as deleted and write a
replacement over it. That separation is stated once, in a shared helper both
URL-addressed adapters call, rather than being spelled out per adapter where the
two copies would drift.

S3 returns an empty buffer for a zero-byte object rather than `null`, for the
same reason: a stored empty file is not a missing one.
