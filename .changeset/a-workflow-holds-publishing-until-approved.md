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
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
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

A workflow holds publishing until each part is approved, on every publish path: a collection's document with a workflow attached goes live only where each part it moves (each language, and the shared part) stands in a stage that allows publishing, holds an approval given under the workflow attached now, and still has the content that approval covers. The gate is asked early and again on the move's own transaction once the entry is locked, and closes each published part's review cycle before the move commits. A person who holds "Publish without review", or trusted code, may publish past review by naming a reason, which is recorded; an API key never may. `nextly.publish()` and `nextly.unpublish()` take `withoutReview: { reason }` for trusted code. A save naming a status the lifecycle does not know is refused where a workflow is attached. A translated document's shared approval now covers its shared fields alone, so a translation saved in any language no longer withdraws it; a shared approval stored before this is withdrawn once, on the next save. Singles are not judged until they take workflow steps.
