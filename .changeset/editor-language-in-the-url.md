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

The content language an editor is open in now lives in the URL.

`?locale=de` makes the language linkable, survives a reload, and comes back with
the browser's back button. An unconfigured value falls back to the default
rather than being sent to the API.

It also stops a language switch from silently discarding unsaved work. Switching
refetches the document, so the edits go — and as component state that happened
with nothing able to ask first. As a URL it is a navigation, which the
unsaved-changes guard already understands, so it asks. The guard now compares
the query as well as the path, because here the query is part of where you are
rather than decoration on it.

A language mark in the entry list opens that row in that language, which is the
same act as being sent a link to it.
