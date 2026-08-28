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

Keep a link on the words that follow a button inside a heading.

A heading may hold only phrasing content, so a button an author put inside one moves out to sit after it — and any words the author wrote after that button move with it, to stay in the order they were written. Those words were being re-wrapped in a single copy of the link around them, together with the button. A link may not contain another interactive element, so the renderer drops such a wrapper, and the trailing words silently lost the link the author had applied to them. The same passage with an image in place of the button kept its link, so one document rendered by two rules. Each run the wrapper may legally hold now keeps its own copy, in the author's order.

A page description also reads a button label stored as a number the same way the page draws it.

A label of `0` — from an import, a migration, or an older row — is drawn as the character "0" on the page, because a stored number is text a reader recognises. The projection that flattens a passage for search indexing and the crawler description accepted only strings, so it described the page without a label the page displays. Both now read through one decision about what counts as authored text.
