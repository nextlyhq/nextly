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

A failure is RAISED, which is the supported way to report one from a side-effect phase. The
hook registry already knows what `after*` means: it catches the throw, keeps the committed
write, logs, runs the remaining handlers, and records a warning the REST and Direct API
responses carry back. So the caller learns the safety index is stale and can act on it.
Swallowing would bypass all of that - the operation would report plain success, and a stale
index is exactly the state in which a class a page still renders reads as unused and can be
deleted.

Every subject is attempted before it raises, and the message says how many of how many failed.
Reconciliation is per-subject and idempotent, so stopping at the first failure would leave the
later subjects stale as well as the failed one.

A write inside a CALLER-OWNED transaction is skipped. Core runs the after-hook before that
transaction commits and binds its executor onto the hook context to say so; maintenance reaches
the database through the pooled Direct API, which cannot join it - so on a small pool it can
stall on the connection the transaction holds, and otherwise it reads a database that does not
yet contain the write it was called for. Rows derived from that read record the document's
previous classes, or none at all for a create, and report success. The rebuild is what repairs
a subject a write bypassed.

The plugin now installs this in its own `init`, so a host that installs the page builder gets
the index table and the thing that maintains it together. A table with no maintenance records
nothing while reporting success, which is the state in which every class on a site reads as
unused.

Deletion is deliberately absent. Removing a document's rows is a different reconciliation -
there is no document left to derive from - and it is built separately rather than bolted on
here.
