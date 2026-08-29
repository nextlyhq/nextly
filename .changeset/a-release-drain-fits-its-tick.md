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

A scheduled release drain now fits the tick it runs in.

Materialising due releases walked every planned action with no deadline. The job
runner cannot bound that — its wall-clock budget is checked before each job is
claimed, so it limits how many jobs a pass starts, never how long one already
running handler takes. On a serverless platform a tick is killed at a fixed
limit, so a site with a large backlog could have its drain cut off partway and
then restart from the beginning on the next tick, re-walking what it had already
done.

A pass now stops starting new actions once its budget is spent, and reports how
many it deferred. It never stops midway through a content mutation: nothing can
interrupt one, and abandoning it half-done outside the database would be worse
than being late. At least one action always runs, so a budget too small for a
single action cannot stall a backlog forever.

Releases whose actions were not reached stay scheduled and are retried on the
next pass, exactly like releases with a failed member. Without that they would
have been marked published having done only part of their work, losing the
members that never ran.
