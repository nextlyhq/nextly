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
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

feat(admin): record the editor values as a server-side recovery point

A debounced hook that writes the values currently in the form to the calling
author rolling recovery point, and reports the status back.

It is not a save. The dirty flag is left exactly as the form set it, so the
unsaved-changes guard goes on firing, and the values are read with getValues
rather than through handleSubmit, which validates and refuses on failure and
would therefore record nothing for the half-finished input most worth keeping.

Recording is triggered by the dirty flag rather than by the update type, which
react-hook-form leaves undefined for any change that does not come from a
registered input own DOM handler.
