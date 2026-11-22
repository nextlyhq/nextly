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

The Form block works with JavaScript off. A visitor sends a form as an ordinary HTML form post through the page builder and comes back to the same page with "Thanks, we got your message." in the form's place, or one clear message above it when the send was refused; the message takes the focus, and the block adds no script. A new Form starts with Name, Email and Message and a Send button, and fields can be Text, Email, Phone, Number, Link, Date, Long text, Dropdown, Checkbox or Choice, added with "+ Add field" and dragged into order. Each field's answer is sent under a name made from its label, required fields are marked, and "After sending" shows a message or goes to a page. A form saved before this opens and sends as before, losing only its send method, since every form now posts through the page builder. A form picked from a form provider is drawn on the server in the same markup and styles, and loads the provider's own script only on pages that draw it (`ctx.forms`, experimental).
