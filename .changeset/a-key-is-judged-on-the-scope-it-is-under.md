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
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
"nextly": patch
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
---

A scoped API key is judged on the scope the request is CURRENTLY under, for
the whole of an operation rather than at the one call that names it.

A route that narrowed its own scope before a transactional write had the
narrowing discarded: the transaction methods sit outside the plugin facade's
wrapper, so the scope reached the argument and never a gate, and the write was
judged on the grant the route had given up. The transaction params carry it now,
including the delete path, where the owner predicate was resolved without it —
so a key owned by a super-admin took a bypass that belongs to a session.

A release operation resolves its target before it acts, and that lookup ran
with no scope at all, so it read on the key OWNER's grants. The scope is pinned
for the operation instead of handed to half of it.

`narrowScope` accepts a caller that has none. A signed-in person reaches the
same routes an API key does, and requiring each call site to guard that is how
a `!` reached the documentation — where it was a crash for every session
caller.

The API-key scope built by the Single detail route named `actorType` and
`permissions` only, so a documented `permissions.includes("site:publish")` was
handed the stored slugs and denied a key that held the grant.
