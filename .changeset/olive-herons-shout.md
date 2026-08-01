---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
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

Run hooks on the paths that were skipping them

Publishing every locale now runs the collection's `afterUpdate` hooks. That
path already emitted its updated event and busted its cache tags, so a
subscriber reached through a webhook and a hook declared in the same codebase
disagreed about whether the content had gone live. The phase runs post-commit,
so a handler's return is ignored and a throw is reported rather than failing a
publish that already happened.

`req.nextly` is now bound for hook contexts from the moment services are
registered. It previously resolved through a binding that `getNextly()` created
as a side effect of its first call, so a process that never called it — which is
any REST or admin write — handed every hook `undefined`, including the worked
example in the collections guide.
