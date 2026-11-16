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

A block can carry CSS class names of the author's own, so a site's own stylesheet can target it. The block document format gains an optional node field, `cssClasses`: text, the names separated by spaces (`"promo hero-dark"`), kept apart from `classes`, which holds the ids of the site's shared styles. The renderers draw the names on the block's root element after the classes Nextly generates, on the published page and on the canvas, for every block, a plugin's included, with no opt-in. A save refuses a name a block can't carry, naming each one and why: one that starts with a digit, `.`, `#` or `nx-` (Nextly's own classes start with it), or holds a character a class name can't. The error is coded `invalid-css-classes`. `checkCssClassNames`, `cssClassNameRefusal` and `renderedCssClassNames` in `@nextlyhq/blocks-engine` answer the same question for one name or one piece of text. The class usage count never counts these names. A page stored without the field reads and renders byte for byte as it did. The field is set through the builder's `update` op and the page's API today; the builder's panel field comes later.
