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

In the admin, "Take the live values" on a publish refused over out-of-date shared fields now stores the editor's form as it is when the action is taken, with the editor's own Save and never publishing, so edits made after the refusal are no longer lost when the editor reloads, and a document view's pending work is committed first. The editor then shows the live values of the fields taken, keeping its other edits, so publishing again no longer sends the old value and puts it back live. If the take's request fails, the editor still reloads before it can be edited again, so it never keeps values the take may have replaced. The refusal toast is one per document and language, and closes when the editor leaves them. Moving to another language while the take is still running no longer writes the first language's live values into the second one's form: the take stands for the language it named, and the editor reloads to show it. In a quick edit, the action says to open the document instead.
