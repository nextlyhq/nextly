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
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-mcp": patch
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

Rich text HTML can now be styled by the site: pass `richTextStyles: "none"` to a Direct API read (or `?richTextStyles=none` over REST) together with `richTextFormat: "html"` or `"both"`, and the HTML carries no style Nextly adds. Every element has a class in the `nextly-rich-text-` namespace (`nextly-rich-text-paragraph`, `nextly-rich-text-h2`, `nextly-rich-text-link`, `nextly-rich-text-button--outline` and so on), and alignment is a class too (`nextly-rich-text-align-center`). Styles an author chose in the editor, a text colour or a button's colours, are kept. The classes are listed in the rich text field docs. Without the option, the HTML is exactly what it was.
