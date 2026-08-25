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

Form editor: give every tab a surface, and balance the metadata card.

The Settings, Preview and Notifications tabs drew no background of their own, so their content sat directly on the page's grey while the metadata card above them was white — the panels read as holes in the page rather than as sheets on it. Each tab now sits on the same white card the rest of the admin uses for form content, and the Settings tab gets there by adopting the shared `FormSection` instead of a heading it had rolled itself, so its sections look like every other settings page in the product.

The metadata card's padding was even at 20px top and bottom, but the first thing inside it is a label and the last is a control: a label's line box carries leading above its glyphs, so the visible gap measured 24px above and 21px below. The bottom step is now one larger, which makes the two read as equal.
