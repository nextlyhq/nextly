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

A new package, `@nextlyhq/plugin-mcp`, for exposing an install to AI agents over
the Model Context Protocol. Experimental, read-only when it arrives, and inert
in this release: it contributes no route, no field and no permission, so
installing it today changes nothing. It is published now so that the protocol
surface lands as additions to a package that already exists rather than as one
drop, and so its release path is proven before anything depends on it.

`enabled` defaults to `false` and stays that way while the surface is
experimental. What the endpoint will expose is an install’s schema and content
to any client that can reach it, so a version bump must never be what starts
serving it.
