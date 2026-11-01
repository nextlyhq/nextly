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

The roles screen sets one level per collection and Single: No access, Can view, Can edit or Can publish (a Single has no create or delete, so its Can edit is view and edit). The levels sit side by side on a wide screen and in a select on a phone. Each row's "Each action" switch shows a switch for each of its permissions; a row whose actions match no level reads Custom and is saved exactly as its switches stand. A base role's grants show on the rows they give to, marked "from" the base, and a row offers no level below them. The roles screen now reads its collections and Singles from `GET /roles/screen`; permissions that belong to no collection or Single stay in the grid below, whose Clear All takes away only its own.
