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

The content client a background job receives now enforces the identity it
advertises, and a transient database error during a job's lease check no longer
stops the whole queue.

The client removed only `overrideAccess` and `user` from a handler's arguments.
Five other authorization-bearing options travelled through untouched, and one of
them was decisive: `actor` carries an API-key scope whose `permissions` array is
read as authoritative rather than being checked against the queued user's
grants, so a handler could hand itself any permission it named. `trusted`,
`enforceFieldAccess`, `fieldAccessUser` and `frameworkFilter` each disabled a
different guard. All seven are now stripped from the call rather than overridden,
and a compile-time check fails the build if a future option is added to the
Direct API without being classified as either owned or safe to forward.

That check immediately found four options nobody had classified.

A job's `ctx.content` also types correctly in a project with generated types.
The client's signatures were derived by mapping over the Direct API, which
collapsed each generic to its constraint: `find({ collection: "posts" })` came
back typed as the union of every collection's row, and `findSingles()` lost its
optional argument.

Finally, the lease re-check a job performs before running its handler could
throw. It sat outside both failure boundaries, so a transient adapter error
aborted the entire drain — leaving that job leased and skipping every other job
due in the same pass. It is now charged as an ordinary attempt, and the job
retries on its own backoff.
