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

A plugin whose relationship to another plugin's entity sits inside a group or a repeater, in its own entities or in a field it adds with `contributes.extend`, must now declare that plugin in `dependsOn`, as for a relationship at the top (`NEXTLY_SCHEMA_CROSS_PLUGIN_RELATION`). Where two field groups share a slug, a cycle through either is reported beside the duplicate slug, rather than only after the duplicate is renamed. Compatibility: a plugin that relates to another plugin only through a nested relationship, and does not declare it in `dependsOn`, is now refused, as one relating at the top already was.

The Builder's definitions (`ui-schema.json`) are judged by the same per-entity rules as the configuration's entities, each problem at its place in the file (`ui-schema.json collections[0].fields`): every command that reads the entities refuses one with the rest of the configuration's problems, and a running development server warns of it and goes on. What the Schema Builder itself saves is allowed: a collection with no fields of its own, and an address the address rule judges where it is new. An entry a code-first entity of its kind shadows is not judged. Compatibility: a hand-edited definition file with a problem those rules refuse (two fields of one name, a field type nothing offers, a slug that is missing or not a string) now stops the commands that read the entities until it is fixed.
