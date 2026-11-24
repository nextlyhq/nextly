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

The version comparison page is redrawn to read like the editor, and a past version in the editor gains Compare. The comparison page puts its actions in its title row (Copy link, and Restore with the version's name), chooses the two versions and the language in one card ("Compare … with …", with a swap), and draws the fields as the editor does: each changed field marked, with "Restore this field" in its heading row, unchanged fields shown among them in the form's order once asked for, and side by side splitting each changed field in place with each side named over it. The list of versions beside the comparison is gone; the history panel beside the document is where a history is read.

A past version offers Compare, Back to current and Restore… through one component, `PastVersionActions`, for the editor's title bar. Inline and Side by side are one choice, both in view. The restore dialog names each field as the editor does (its label, else its name made readable, with the containers it sits in) rather than by its key, quotes the value each puts back, marks shared fields and unsaved edits it replaces, and says under the list what the restore changes and leaves alone. "Restore this field" on the comparison page opens that list with the one field chosen.
