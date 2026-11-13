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

A workflow now tells the people it names. When a part of a document is assigned to a person (directly, or as a stage's default reviewer when the part enters that stage), that person gets a notice in their list of notices. When a part is approved or sent back with requested changes, the person accountable for the stage it left gets one: whoever brought it into review, by a step or by an edit, including on a workflow with no submit step. Each notice names the collection, the document's title, the language (or the shared fields), the step and who acted, and links to the document's edit page; once the document is deleted it says so and has no link. Where the site sends email, the notice is also emailed, unless that trigger's email is switched off in the workflow's settings (`emails.assigned`, `emails.approved`, `emails.changesRequested`); the notice itself is always given. Work assigned to a role tells no one, nor does a part no one is accountable for, and nobody is told of their own act. Release notice emails look and behave as before.
