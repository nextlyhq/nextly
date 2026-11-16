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

`@nextlyhq/plugin-sdk/admin` gains `registerSchemaTemplates` and the types `SchemaTemplate`, `SchemaTemplateField` and `SchemaTemplateKind`, all `@experimental`. A plugin uses them to offer templates for a new collection, Single or field group in the Schema Builder. A template is a plain declaration of the fields it adds. It is checked when picked by the same rules as a field typed into the Builder: names by the save's own rule, sibling clashes, types the Builder offers, and unique fields only where a unique value can be kept. The Builder also ships its own templates: Blog posts, Authors, Products, Site settings, Home page, SEO and Address. The addition is new surface only; nothing published before changes.
