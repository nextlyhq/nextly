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
---

Every dashboard card now wears one frame, with the same five states and one number format.

The frame draws each card's title as one `h2`, an optional description line, the body, at most
one footer link and when its data last arrived. While data has never arrived it shows a skeleton
shaped like the card's body; while it refreshes it keeps the last value and marks the card busy;
an empty card says what will appear there; a card whose source is not available to the reader
says so in one fixed wording; and a card whose data failed keeps its title and offers Retry,
which asks that card's question again on its own. In customise mode the card's content stays
visible but out of reach, and the title appears once.

Collections, Singles and Team now draw inside the frame too, rather than as sections with their
own headings, loading and error states.

`@nextlyhq/ui/format` is a new server-safe, `@experimental` entry point: `formatCount` and
`formatChange`, the one formatter every figure on a card goes through, in the admin's locale.
Values from 1,000 compact ("1.2k") only in a card's small size tier, a floor reads "N+", the
accessible name is always the full value, and a change carries an arrow and a sign.

A failed widget slot may carry `code: "unavailable"`, which the admin shows as the
"not available" state instead of an error.
