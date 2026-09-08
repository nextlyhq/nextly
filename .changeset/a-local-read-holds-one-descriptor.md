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

The default storage adapter resolved a file by name three times to read it
once: to validate the path, to ask for its size, and to pull in its contents.
A file replaced between the second and the third came back under a cap
measured on the file it displaced, and one still being appended to was
buffered whole however small it had been when asked. The read deadline reached
it not at all, so a storage directory on an unresponsive network mount held a
read open with nothing left to end it.

A local read now runs against one open descriptor, counts the bytes as they
arrive instead of trusting the size reported beforehand, and answers within
the deadline it advertises — the same bounds the cloud adapters already kept.
