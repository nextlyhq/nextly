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
---

Add the admin side of shareable preview links.

A `previewLinkApi` service and a `usePreviewLink` hook mint a link for one entry and put it on the clipboard. This is distinct from the Preview button beside it: Preview opens the entry using the editor’s own session and can include unsaved changes, while a preview LINK goes to someone with no session at all, so it carries its own signed authorization and shows only what was saved.

The link is minted per click rather than cached, because it carries an expiry and a cached value would be handed out after it stopped working. When the browser refuses clipboard access, which happens on an insecure origin, the link is shown rather than a copy being claimed that never happened.
