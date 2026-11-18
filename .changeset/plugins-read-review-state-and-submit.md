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
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-mcp": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

Plugins can read review state and submit for review for the person or API key they act for, through `ctx.services.workflows` (experimental): `reviewState`, `definitionOf` (a workflow's stages and steps, without its settings), `waiting` and `submit`. Each call is judged as the REST routes judge that caller, a key by its own scope; the plugin acting as itself is refused. `submit` takes only a step of kind `submit`, refusing any other with `WORKFLOW_STEP_NOT_SUBMIT`, and with no step named takes the submit step out of the part's stage, refusing with `WORKFLOW_NO_SUBMIT_STEP` where there is none. The plugin SDK exports the service's types.
