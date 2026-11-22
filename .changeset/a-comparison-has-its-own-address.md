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

A comparison has its own address that can be shared. `…/versions?from=&to=` names the two sides:
`from` is a version number or one of `previous`, `published`, `draft` and `last-viewed`, which
the server resolves; `view=inline` or `view=side` picks the layout. On the page, "Compare with"
and the layout switch write the reader's choice to the address. When the version you last
looked at is no longer kept, the page says so and names the version it compares with instead.
Opening a comparison marks its newer version as seen. "Restore…" opens the editor's restore
list for the version on show. Nothing is written until you save there. On a document with
drafts, that save keeps the draft unpublished; a document without drafts saves straight to the
live document.

The comparison page follows its own language and visit. An address that names a language but no
version (`?from=published&locale=fr`) compares that language's part, and "Restore…" opens the
editor in the language of the comparison on screen, even when the address names none. "The
version you last looked at" is worked out afresh on each visit to the page. A comparison against
a baseline is fetched once, not twice. Every baseline the server registers can be named in the
address, the workflow ones (`since-submitted`, `since-approved`) included; a name it does not
know is answered with the ones it does. A comparison that failed to load offers "Try again", and
"Restore…" stays available for the version named while there is nothing to compare it with. The
version list marks both versions being compared, with the version compared to as its current row.
Closing history before a version handed over by "Restore…" has loaded no longer leaves the
restore request behind. When there is nothing to compare with, the reason is a plain sentence
rather than the baseline's name in quotes. New, experimental: `nextly/comparison-baseline-name`,
the one grammar a baseline's name has, which the server registers names by and the admin reads an
address by.
