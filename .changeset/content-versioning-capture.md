---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"nextly": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/ui": patch
---

Enable content versioning per collection and single, and record a version snapshot on every create and update.

A collection or single can now opt into versioning with `versions: true` (or a `versions: { ... }` config); `status: true` also enables it. The resolved config is persisted on a new nullable `versions` column on `dynamic_collections` and `dynamic_singles` (all three dialects, additive) so existing tables pick it up as a plain `ADD COLUMN` on the next schema apply.

When a collection or single is versioned, every create and update writes one durable `nextly_versions` snapshot inside the same transaction as the content write, so the version commits atomically with the document (no partial history on a rolled-back write). The snapshot is the fully assembled document (parent columns plus component subtrees and many-to-many ids), which is the same shape a read returns, so a restored version equals a normal read. History-only at this stage: the captured status is the document's status when present, otherwise `published`; the draft/publish split, autosave, and retention pruning arrive in later stages. Batch (`createMany` / `updateMany`) capture is a documented fast-follow.

Concurrent updates to the same document can race on the version number; a lost race is detected as a distinct conflict and the whole transaction is retried (a re-run re-reads the next free number). SQLite serializes transactions and never races; Postgres and MySQL retry.

Also adds a general `document.statusTransition` event that fires on every status change (carrying `previousStatus` / `status`), alongside the existing `document.published` and `document.statusChanged` events, so workflow logic has one seam to build on.
