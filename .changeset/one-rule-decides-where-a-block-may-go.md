---
"nextly": patch
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/plugin-mcp": patch
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

Page builder: one rule now decides where a block may go, in the editor and on every save. It adds the HTML content model to the existing `parent` and slot `allow` checks: nothing clickable inside a link or a button, no header or footer inside another, and a `main` only inside plain boxes. It also refuses a block in a slot its container does not declare, which the container would never draw. Box and Card gain a `link` that makes the whole block a link. Blocks can declare what they are as HTML through an optional, experimental `contentModel(props)`; a block that declares nothing keeps working as before. A page saved before the rule keeps its existing breaks as warnings and still saves other changes; a write that adds a break is refused, worded the same way in the editor and from the server.
