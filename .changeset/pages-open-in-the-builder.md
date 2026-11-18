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

Pages now open straight in the Page Builder. Clicking a page in the Pages list, a row the list's search found or a page on the dashboard's Continue card opens it in the builder, on its page, and so does any entry whose collection's main field is a Page Builder field, a collection made in the Schema Builder included. Old links to a page's form still open the form, and a collection that sets `admin: { opensIn: "form" }` keeps opening as a form.

In the builder, the top bar's new ⋯ menu offers "Open as form", which opens the page's form with unsaved changes carried over and nothing asked, and "Pin to dashboard" / "Unpin from dashboard", the same pin as the form's, with its message and Undo. On a page the back arrow reads "Back to Pages" and returns to the list, asking first while changes are unsaved; elsewhere it stays "Exit editor" and returns to the form. Where an entry opens as a form, its row menu and document bar offer the builder as "Open in builder".

For plugin authors (experimental): `useDocumentOpensIn()` says where the entry being edited opens and names its list, and `PIN_TO_DASHBOARD_ACTION` is the pin action's id among `useDocumentActions().actions`. The builder's shell takes an `exitLabel` for its exit arrow.
