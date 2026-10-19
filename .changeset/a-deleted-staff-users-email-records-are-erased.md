---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
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
---

Deleting a staff user now erases every email delivery record that names
them, whatever address it went to, including addresses they used before an
address change. The record keeps its row, loses its address digest, and names
the user by a keyed digest in place of their id. The user is added to the
deleted-people list that plugin-defined people already use, so a record
written for them after the deletion (a send that was in flight, a retry, a
provider's later report) is written erased, even after the delivery log's
retention has pruned their earlier records and after the install's secret is
rotated.

The erasure by the address the user holds at deletion still runs, now only for
records that name nobody, so another person who holds or once held the same
address keeps their records. An email the provider had already accepted may
still be delivered; the docs say so.
