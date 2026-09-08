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

Stop a group of releases as one indivisible step, and refuse to schedule a release that cannot run. Releases that share a document are only ever discharged together, and stopping them one write at a time left the group split whenever a process died partway — the survivor then became the winner on every shared document and could take the opposite lifecycle action to the one the whole group would have produced. Ordering the writes was not enough and could not be made enough: two releases scheduled for the same instant are separated per document by when each member was added, so each can win a different document of the same group, and no ordering of releases preserves a winner chosen per member. The group now moves inside one transaction, so a partial transition cannot be represented at all. Scheduling also now refuses a release with a member nothing can run — a deleted author, no recorded author, a member naming one language — from every state rather than only from a release already marked as stopped, because a colleague leaving does not wait for a background pass and the person scheduling cannot see whether one has run.
