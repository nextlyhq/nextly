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

Every part of an email that holds Liquid is now edited in a code editor that reads it: the subject, preview text, From, Reply-To, and the HTML and plain-text bodies.

- **Completion:** typing inside `{{ }}` or `{% %}` offers the email's variables, their properties from the sample data, and the Liquid tags and filters an email can use. Tags and filters an email can't use aren't offered.
- **Problems as you type:** an unclosed tag or an unknown filter is named at its line, with the parser the server renders with, so a template that would fail to send says so before you save. The body lists its problems under the editor; each envelope field shows its own.
- **Inserting a variable** from the chips goes in at the cursor of the body you're editing.
- **Sample data** in the Data panel is edited in the same code editor, which checks the JSON.

The editor loads when a workbench first shows it, so the rest of the admin doesn't load it.
