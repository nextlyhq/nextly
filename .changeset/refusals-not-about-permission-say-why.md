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

Refusals that aren't about permission now say why, and stay 403 `FORBIDDEN`:

- A person-only action asked by an API key: "Only a signed-in person can manage API keys." (or webhooks, preview links, a dashboard layout, notices, or marking a version as seen).
- A change or delete of a role or permission built into Nextly: "This role is built in, so it can't be changed." (or "deleted", or "permission").
- A trigger request from a site the installation doesn't allow: "This request came from a site that isn't allowed to make it."
- A Single deleted without `force`: "A Single can't be deleted from here."

Each used to read "You don't have permission to perform this action.", which sent people looking for a permission that wouldn't help. Refusals for want of permission are unchanged: they never say which check refused.
