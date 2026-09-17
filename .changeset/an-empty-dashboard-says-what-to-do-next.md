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

A reader who can see no content yet no longer meets a dashboard of empty
cards. The layout read reports `contentEmpty` — whether this reader can see any
content at all, from the same reader-scoped count the onboarding steps use —
and the admin draws one next step in place of the cards: create a collection,
load the template's demo content, add a first entry, or, for a reader who can
do none of those, a plain note that nothing is here yet. The demo-content offer
moved out of the card grid into that state; it announces its progress to
screen readers, stays on screen through a seed until the reader continues, and
its skip control is now reachable from the keyboard. Editing the dashboard
still shows the ordinary grid, and no card data is requested while the empty
state stands in for the cards.
