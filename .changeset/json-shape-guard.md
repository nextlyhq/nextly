---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
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
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
---

Plugin options on a code-defined user field are no longer refused when two of them share a reference, and a sparse array in them is now rejected rather than silently reshaped.

The JSON-shape check treated every object it had already visited as a cycle, so one object referenced from two places within a single option was refused even though it serializes correctly at both. It now tracks only the objects on the active path. It also walked arrays with a method that skips holes, so a sparse array passed the check and then had each hole written as `null`, handing the plugin's component different data than was declared.
