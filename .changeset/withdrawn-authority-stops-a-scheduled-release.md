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

Withdrawing somebody's access now stops their scheduled releases too.

A release runs every action as the person who scheduled it, deliberately, so
that scheduling cannot become a way to publish something you were not allowed to
publish. The read side did not know that. It projected any due member of any
scheduled release without checking whether that person still existed or was
still active — so deactivating an employee stopped their scheduled publish from
being written while every visitor went on seeing it as published.

It was permanent rather than temporary. A member whose author cannot be resolved
fails, a failed member holds its release open, and a release that stays
scheduled goes on being projected forever.

The read path now derives from the same answer the write path does: a due member
is projected only while its author exists and is active. A member with no
recorded author is not projected at all, matching the write path's refusal —
there is nobody to act as, so it describes an effect no write could perform.

If the lookup itself fails, nothing is projected rather than everything: a
database that cannot answer must not be read as "everyone is still authorised".
