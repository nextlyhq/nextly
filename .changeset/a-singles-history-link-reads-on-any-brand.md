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

Small links and buttons in the admin now read in the admin's own text colour rather than the brand's primary colour:

- a Single's "History" link under Last changed;
- "Clear date filters" in a collection list's Filter menu;
- "Forgot password?" on the sign-in page;
- the content widget's "Launch Initial Entry" and the stats grid's "Infrastructure" on the dashboard;
- the media library's "Move" in its bulk bar;
- the file drop area's browse hint.

They were drawn in the brand's primary colour. A site can set that to a shade too light to read as small text on a light surface: an indigo such as `#6366f1` falls under the 4.5:1 small text needs. The links among them are underlined at rest, so they still read as links. Icons, spinners and tinted chips keep the brand colour.
