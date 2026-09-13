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

The signal that retires a cached authorization answer is now stored in the
database, so every instance sees it. It was a counter held in memory, which
moved only in the process that handled the change: a second instance neither
saw the move nor had one of its own, and went on serving what it had cached
until the entry aged out. On the shared tier that meant a revoked grant could
outlive its revocation by the whole cache lifetime.

Cross-instance revocation now takes effect within about a second. Each instance
reads the shared counter at most once per second rather than once per check, so
the cost is one small indexed read per second per instance and not one per
request. The instance that MADE the change applies it immediately.

Two behaviour changes worth knowing about.

An invalidation naming one user now retires every in-memory answer rather than
that user's alone. The counter other instances read carries a number and not a
user id, so a change they can see cannot be narrower than "something in RBAC
moved", and keeping the scope locally would mean only the instance that made the
change applied it narrowly. Refilling is a couple of indexed queries and role
changes are rare; a stale answer costs a grant the install revoked.

A batch of permission writes no longer holds back the in-memory tiers. It never
existed to: what it saves is the unfiltered rewrite of every stored row, and
that is still deferred to the end of the batch.

Installations upgraded from an earlier version keep working before they
reconcile their core tables. The new table arrives through `nextly db:sync`, and
until it does, every read and write of the counter degrades to the previous
in-memory behaviour rather than failing the authorization check that asked. The
degraded state is reported once so an operator can see why cross-instance
invalidation is not yet in effect.
