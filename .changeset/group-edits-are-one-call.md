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

Two corrections to the builder's op layer.

The style inspector still refuses a multi-selection — it says how many blocks
are selected and asks for one — so nothing an author can do changes here.

A group of ops whose members cancel out no longer records a history entry. Each
op changed something, the document ended where it began, and an entry recording
that would undo to no visible effect, which is the refusal a single op already
gets. A group reaches it by a route a single op cannot take: grow a value, then
restore it.

Applying a group is one call rather than a fold at the call site, so what a
group MEANS — its atomicity, its inverses in undo order, and answering with no
inverses when it changed nothing on balance — lives in one place. A group of one
is the single op call and nothing more.

The caps are unchanged. Every op in a group is still judged against the document
as it stands when that op runs, which is what keeps an accepted edit undoable:
a group allowed to exceed the cap in passing can hand back an inverse the cap
then refuses, and undo pops its entry before replaying it.
