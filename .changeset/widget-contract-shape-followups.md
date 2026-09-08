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

Three follow-ups to the widget contract boundary.

`chrome` is a string in every version, and moving its closed vocabulary to the
registry took the shape check with it -- so `chrome: 42` was published as a
`WidgetChrome`. The renderer treats anything but `"none"` as `"card"`, so it
rendered and boot said nothing about a configuration its author got wrong.

The divergence rows now name the diagnostic they exist for. A fixture can
violate more than one rule -- `{ defaultSize: "sm", minSize: "xl", maxSize: "sm" }`
breaks both size orderings -- so a row could stay green when its own rule was
deleted and another caught the input.

And an acceptance case for `{ component, chrome: "none" }` with no archetype,
which is the typed and renderable form: resolution supplies `custom`, where
`"none"` is legal. Nothing else exercised that standing through the chrome rule.
