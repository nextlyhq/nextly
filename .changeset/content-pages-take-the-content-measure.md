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
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

Editing an entry or a single now uses the width a document needs, instead of
the narrower column meant for a settings form.

The editor shared one reading width with pages like Settings. That width suits a
short list of labelled controls, but an entry is a document: its fields include
rich text, media and repeated groups, and the document panel on the right was
taking its share out of the same column. On a large screen the field you type
into ended up under half the width of the area around it, the editor toolbar
wrapped onto a third row, and the buttons in the header dropped their labels to
show as icons alone.

Entries and singles now use the wider of the two measures, in every state the
page can be in — while it is loading, when it cannot load, and once it has
loaded. A page that changed width as its content arrived would move every field
sideways at the moment the data appeared.

Settings pages are unchanged. The narrower width is right for them, and that is
the point: which width a page takes now follows from what the page holds.
