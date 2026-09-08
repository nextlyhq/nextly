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
"@nextlyhq/plugin-form-builder": patch
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

Give the page builder's Settings panel something to show. It was offered on the rail and opened blank for the commonest shape a collection takes — a title, a slug and a builder field — because the panel was filled from the entry form's body rule, which strips title and slug on the grounds that the form header already draws them. A builder covering the whole window suppresses that header, so the two fields most worth reaching from inside the editor were the two being withheld, and a document's own name could not be read there at all. The panel now offers them, grouped as Page above the collection's own fields, and it is withheld entirely when a document genuinely has nothing beside its builder field. `useEntryFieldsPanel` takes the asking field's path and answers with the fields drawn, or null — one value for both the decision to offer a panel and what goes in it, so a surface cannot offer a region it renders nothing into.
