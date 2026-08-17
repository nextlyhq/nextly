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
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

Opening a document's version history no longer takes the document away. The panel was built on a
modal surface, so it dimmed the page behind a scrim, trapped focus inside itself and withdrew
everything else from the accessibility tree — leaving the one thing an editor needs beside a
version, the document itself, unreachable and unscrollable. It is now a non-modal panel: the page
stays lit, scrollable and focusable while history is open, and the panel closes from its own
controls or Escape rather than from any click into the page.

The Sheet primitive gains the same capability for every caller. Its root already accepted Radix's
modal flag; the scrim is now derived from that one value rather than decided separately by the
content, so a non-modal sheet cannot paint a scrim over a page it deliberately left interactive.
Existing sheets are unchanged, because modal remains the default.
