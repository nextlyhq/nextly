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

A template whose fields need another entity, such as a link to a collection that does not exist yet, now offers to make it too in the new-entity dialog. Each needed collection or field group that is neither saved nor waiting unsaved is listed under the picked template with "Create the … too", which is checked by default. One the server would refuse is named instead. Create waits until each need is made too or the field needing it is left out. The entities made too wait unsaved with the new one and belong to it. Its first save lists them under "Created first" in the review, then creates them, each before anything that needs it, and then the new entity. Discard all lets them go with it. The save that creates first now takes collections a field links to, as well as field groups a field uses, and writes each one's definition as that kind's own first save does.
