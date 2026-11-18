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

The roles screen and the API key list behave as they read. **Cancel** on the Add Role and Edit Role forms now goes back to the roles list without saving, where it did nothing. An empty role name, or one of spaces alone, now reads "Role name is required." rather than that it is too short, and on a new role the slug, which the name fills in, no longer shows an error of its own beside it. Under a collection's or Single's **Each action** switch, turning on Edit, Delete, Publish or Unpublish turns View on with it, and turning View off turns them off, so a role can no longer be saved able to edit entries it cannot see; Create still turns on alone, as the Public role creates form submissions it is never shown. The API key search now names every field it matches: name, description, type, role and key prefix.
