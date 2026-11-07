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

The admin shows an entry's own design where an author meets it: a Design section first in every entry's side panel (which design the entry is shown with, giving it its own design, editing or removing it, and the template to open or create where its collection has no published one), a Design column on the entry list of a collection with a template, and, on a template, the entries with their own design in its side panel and a count in the builder's top bar. Deleting a template from its document says first which own designs are kept and that the collection's other entries stop being shown as pages. The page builder adds `GET /templates/entry-designs`, a collection's own designs and template read as the caller, and the `delete-template` template action. The admin draws side panel sections declared at the `collection.edit` place where they are placed among the panel's own sections, leaves out a plugin's panel section whose component draws nothing for the document, and adds a list column or action a plugin registers while the list is on screen.
