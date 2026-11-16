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

A new Table of contents block lists the headings of a passage of rich text, each linking to its heading. It nests the headings as the passage does, lists H2, H2 and H3, or H2 to H4, starts open under a title a reader can fold away, and draws nothing on a page when there are no headings. On a collection template, bind its Content to the same field as the article body so every entry gets its own contents.

Every heading the Rich text block draws now carries an id made from its words (`Getting started` becomes `getting-started`, a repeat `notes-2`), so a link can reach it. Nothing visible changes on existing pages. The ids are unique within one passage; two passages on one page with the same heading share its id, and a link to it reaches the first.
