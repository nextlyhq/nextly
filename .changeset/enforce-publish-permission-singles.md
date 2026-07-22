---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
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
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
---

Publishing a Single document now requires the publish permission.

A write that moves a Single into published needs `publish-<slug>`, and one that
moves it out of published needs `unpublish-<slug>`, on top of the update
permission — the same split the collection write path enforces. The check is
judged on the final post-hook status (a hook that derives `status: "published"`
still requires the permission), a non-default-locale translation is gated on
that locale's own companion status, and a Single without the draft/published
lifecycle never demands the permission for an ordinary field named `status`.
Trusted server writes (overrideAccess) are unaffected.
