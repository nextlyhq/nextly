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
"@nextlyhq/plugin-form-builder": patch
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

Moving a block with the keyboard now explains itself when the move is not
allowed. Before, a block that could not go where you sent it simply did not
move, with nothing said — while dragging the same block showed you why and what
would work instead. The reason reached people using a mouse and nobody else,
which is backwards: the keyboard route is the one someone uses when they cannot
drag.

The wording is the same one a drag shows, so both routes say the same thing. If
the move fails for a reason the layout rules do not explain, it says only that
the block did not move rather than inventing a cause. Pressing up on the first
block is still silent — there is nowhere to go, and saying so on every press
would be noise.
