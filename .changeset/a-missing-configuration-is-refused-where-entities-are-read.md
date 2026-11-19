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

A command that reads the app's collections, Singles and field groups now refuses a project with no configuration file, naming every place it looked, `-c` and `create-nextly-app` (`CONFIG_MISSING`), where it went on with an empty configuration and generated, migrated or pruned as if the app declared nothing. Commands that read none of them (such as `setup-token`, `webhooks:prune`, `generate:manifest` and `migrate:down`) and the running site keep the default configuration. The development server reports a refused configuration as the commands do, each problem with its path and fix. A field with no `type` is reported once. A plugin's field named like a `define*` collection's `title` or `slug` system field is reported as declaring it twice. A Builder entity the definition file lost, which a plugin extends or a relationship names, is refused as lost (`BUILDER_DEFINITION_MISSING`) by every command, rather than as a target nothing declares. Compatibility: a project with no configuration file, which these commands accepted before, is now refused by them; pass `-c` or run the command from the project folder.
