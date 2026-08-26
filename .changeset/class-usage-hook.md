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

The page builder now maintains its class-usage index on every write.

ONE registration on the wildcard, not one per collection. The set of collections is not known
when a plugin is wired - the Schema Builder creates them at runtime, and a blocks field can be
added to an existing one - so a list captured at registration would silently stop covering the
collections that were added after it. The wildcard resolves when the hook executes and the
filter is applied inside, against the collection's LIVE configuration.

The cheap filter runs first. The hook fires for EVERY collection on EVERY save, and most
declare no blocks field; the draft-split question below it reaches the component registry, so
an untracked collection must not reach it. That ordering is what makes maintaining the index
affordable at all.

Whether a collection keeps a working draft is ASKED rather than assumed, through the published
question. It cannot be read off `status`, which is true for collections that keep no draft -
and every collection reaches this hook through the registry, which stores `versions` already
resolved, including collections defined in config: the sync writes them through
`resolveVersionsConfig`. Guessing it wrong files rows against a document that does not exist,
or omits the classes only a draft applies.

The plugin's own index table is skipped. Every row it inserts is a create on that collection,
which fires this same hook - so without the guard the first maintained save recurses.

Nothing escapes. Collection `after*` hooks run once the write has COMMITTED, so a throw is
reported to the caller as a failed save for a document already on disk - the author is told
their work was lost when it was not. Every failure reaches the logger instead, including the
ones this code is responsible for. An index that disagrees with a document is recoverable by a
rebuild; that false error is not recoverable at all.

Deletion is deliberately absent. Removing a document's rows is a different reconciliation -
there is no document left to derive from - and it is built separately rather than bolted on
here.
