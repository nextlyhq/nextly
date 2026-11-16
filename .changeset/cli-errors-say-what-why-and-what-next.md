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

Every `nextly` command that fails now ends with the same four lines: what happened, why, what to run next, and a link to the page for its error code, under a code of its own (`CONFIG_NOT_FOUND`, `CONFIG_SYNTAX_ERROR`, `SCHEMA_LOCK_HELD`, `DATA_LOSS_CONSENT_REQUIRED` and the others listed at https://nextlyhq.com/docs/cli/errors). It no longer prints an internal envelope such as `[INVALID_INPUT] Failed to load Nextly configuration. | Config loader error | context: {…}`, and a configuration's syntax error is shown once, with its file, line and column. `--verbose` (or `DEBUG=1`) adds the internal context and the stack below those lines. The CLI's codes are separate from the REST API's error codes, which are unchanged; each keeps its meaning in later releases, and the codes the production-migrations guide documents (`MIGRATION_TAMPERED`, `MIGRATION_MISSING`) keep their spelling. The exit code of a failed command is still 1.
