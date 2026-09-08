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

Make the document title one value rather than two copies of it. The entry header kept its own copy of the title, so a rename made anywhere else never reached it — and a takeover field can now do exactly that: renaming a page in the builder's settings panel left the header behind the editor showing the old name, and the next keystroke there saved the old name back over the rename. The header's title moves into `EntryTitleInput`, which reads the form rather than holding a copy, and is a control the header's other surfaces can reuse. Separately, the settings panel no longer counts a group whose every child is conditioned away: those children render nothing, so counting them offered the panel with a heading over an empty group. Conditions on nested fields are now read at the qualified path the renderer resolves them against.
