---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"nextly": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/ui": patch
---

Media bulk uploads now report every file honestly, and one bad file no longer sabotages the batch.

**Dropping more than 10 files no longer rejects the whole batch.** Previously a drop of 11 valid files uploaded nothing and labeled every file "Too many files". Now the first 10 upload and the rest are listed as skipped, each saying so.

**A batch with an oversized file now reads as what it is: a partial success.** Previously 9 valid files uploaded silently behind a full-width red "Invalid file type or size" panel, and the 9 success rows vanished after 2 seconds while the error stayed. Now every file gets its own row in one upload queue: per-file progress while uploading, a green check per success, and a persistent human-readable reason per failure ("File is too large (max 10 MB)" instead of "File is larger than 5242880 bytes"). The summary line reports "9 uploaded, 1 failed" and the queue stays until dismissed whenever anything failed; all-success queues dismiss themselves.

**The upload drop target now closes itself when an upload starts** — no more hunting for the close icon — while the queue stays visible. Files that fail on the server get a one-click Retry.

Also: the client-side size limit default now matches the server's 10MB default (it was 5MB, so files between 5 and 10MB were refused by the client that the server would have accepted), the dropzone no longer nests interactive buttons (invalid markup), and its status colors now use the design system's semantic tokens.
