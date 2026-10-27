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

A full-access API key made by an active super-admin now acts with super-admin authority at every way in: it holds every permission, passes every collection and Single access rule and the read rules of related collections, and reads the schema journal. Field rules still apply to it, as they do to a super-admin.

- **Only a full-access key, and only while its maker is an active super-admin.** The authority is worked out for each request from the maker's standing, so the key loses it when the maker does (the super-admin role removed or expired, or the account deactivated) and gains it when the maker becomes a super-admin, within the bound the maker's own sessions follow.
- **Read-only and role-based keys keep their types' limits**, whoever made them, and pass no access rule a super-admin would pass.
- **A plugin route that narrows a key's scope** (`narrowScope`) carries none of this authority: the narrowed scope is judged on its own grants.
- **`nextly.access.checkApiKey` returns an optional `actor`** (experimental): the key's own scope, to pass as the Direct API `actor`, so a route that checks a key itself is answered as a request on that key is.
- **A key's super-admin authority lasts no longer than the bound a session follows** when its scope is kept past its request; after that the scope is judged on its grants alone.
- **What Nextly keeps for a signed-in person still refuses every key**, this one included: granting or taking away super-admin, creating a preview link, and marking a version as seen.
