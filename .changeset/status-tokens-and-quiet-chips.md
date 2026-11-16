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

Status colour now comes from one set of tokens per status: `success`, `warning`, `danger` and `info`, each with a `surface`, `border`, `text` and `solid` value in light and dark (`--nx-success-surface`, `bg-warning-surface`, `text-danger-text`, `bg-info-solid` and so on). Each status's text reads at 4.5:1 on its surface, on a card and on the page, and its solid at 3:1, in both themes. `danger` is a status (Failed, Error); `destructive` stays the colour of a destructive action.

`Badge`'s status variants (`success`, `warning`, `destructive`, and a new `info`) are now quiet chips: the card surface, ordinary text, and a small dot in the status's colour before the label. `Alert` keeps the page's own text colour: `info` and `success` are plain cards and `warning` and `destructive` sit on their status surface, with the icon in the status's text colour. The coloured bar down an alert's left side is gone.

The numbered status shades (`bg-success-100`, `text-warning-700`, `bg-destructive-50` and the rest) are deprecated. They still build for existing code and plugins, and will be removed in a later minor release. Use the status tokens instead.
