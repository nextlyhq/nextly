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

The entry and Single editors draw one header row with one main button. The button follows the person and the stage: Publish, Publish changes, Submit for review or Approve. Its menu holds Save draft, the other ways to publish (Schedule…), the preview and the document's other views (Open in builder), and, for a person allowed to publish past a workflow while something waits for approval, "Publish without review…", which asks a reason. "Request changes…" is the only button beside it, on the reviewer's turn. A main button that is held (Publish waiting for approval) stays focusable, shows a lock and opens its reason. The side panel's Review section shows the stage, who it waits for and who it is assigned to, with one Assign… picker of people and roles, and its Publishing section shows only once the document is scheduled.
