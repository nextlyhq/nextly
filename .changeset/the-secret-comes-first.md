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

The webhook signing secret is now the first thing on the edit page, not the last.

Setting up an endpoint means copying the signing secret into the receiving
system. That value sat below every configuration field, so the task a person
arrives to do was reachable only by scrolling past the form they had not come to
edit — and on a short window it was not visible at all.

The secret, its rotation controls and the link to the delivery log now sit in
one panel under the page header, which is where an integration credential lives
in every service a developer already uses. Configuration keeps its own reading
order beneath, and deletion stays at the bottom: the one irreversible act on the
page is not something to put where a reader lands.

Nothing changes about who may do what. Rotation was never gated on the update
permission and still is not, which is pinned by a test so a later reading of
`canManage` as "may rotate" has to be a deliberate change.

The create page shows no panel, because an endpoint has no secret until it
exists.
