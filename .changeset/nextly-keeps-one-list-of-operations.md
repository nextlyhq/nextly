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

Nextly gains one list of operations, which the CLI and the agent doors will be built from. Nothing you run changes yet. Each operation is declared once with its command words, summary, description for agents, input and output schemas, examples, risk level (`read`, `draft`, `change` or `critical`), its effects, the doors it may run on, whether chat apps may see it, its permission, its exit codes and its old names. Assembling the list is refused when two operations claim one ID or one set of command words, or when a declaration leaves a fact out, lets an input lower its level, or writes without a dry run. Each refusal names the operation and the plugin or core that registered it. Nothing builds the CLI from the list yet; once it does, that refusal stops the CLI from starting. The list is `@experimental`.
