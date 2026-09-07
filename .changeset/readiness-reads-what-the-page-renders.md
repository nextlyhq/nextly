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

The readiness notice reads definitions the way the page renders them.

Relationship depth is no longer forced to zero. The renderer's component read
states no depth, so the collection service expands to its default before running
`afterRead` hooks. Forcing zero handed those hooks bare ids, and a hook whose
blocks output depends on an expanded relationship then produced a different
component graph than the page draws — missing an unpublished component, or
naming one no visitor meets.

A bulk write's warnings reach a consumer that renders its own feedback. They
were carried into the built-in toast only, so turning `showToast` off to handle
them yourself was the one route that could not see them: the presenter being
opted out of was the only thing reading the array. Post-commit hook failures
were lost the same way, not just readiness notices.
