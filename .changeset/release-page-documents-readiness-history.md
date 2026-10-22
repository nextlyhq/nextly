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

A release's page now names its documents by title, grouped by collection, and says of each whether it goes live or comes down and whether it is ready, with what is wrong and the way to fix it: open the document, or take it out. A summary says how many are ready ("5 of 6 ready"), and Schedule and Publish now wait while a document would stop the release. Documents the reader may not view are counted in their collection ("2 documents you can't view · Posts") and never named. The title and description are edited in place by someone who may rename releases; a document is switched between going live and coming down, or taken out, by someone who may change the release's documents; and Schedule, Publish now, Cancel and Delete are offered as on the releases list, each only to those the server says may take it. Taking the only document out of a single-document release says first that it cancels the release, and is held back, with that reason, from someone who may not cancel releases. Beside the documents, the page shows the release's owner, time zone and creation date, and its history from the record of content events: who created, renamed, scheduled or ran it, and which documents were added, switched or removed.
