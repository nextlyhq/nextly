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

A card's settings sheet keeps a change where the reader is, shows the card beside the form, and reopens on what is stored after Cancel.

- **Done** while customising holds the change with the dashboard's other unsaved changes and closes the sheet. At rest it saves the change at once: the sheet stays open while saving, closes when the save lands, and says why in place when it does not.
- **A live preview** draws the card as the form's values would, with the dashboard's own renderer, beside the form on a wide screen and above it on a narrow one. A change that alters what the card asks, such as its number of rows, is asked once for the preview alone after the values settle. The card keeps its own answer until Done.
- **Cancel** now discards the change. The sheet used to reopen on the value the reader cancelled, although nothing had been saved: the form was given the sheet's own starting values rather than a copy, and wrote into them.
- **A quick setting** whose new answer the card could not load is announced as saved, with the card still showing its earlier data, rather than not announced at all.
