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

The document editor shows a workflow's next step. Where a workflow holds a collection's or a Single's publishing, the header leads with the step the person may take (Submit for review, Approve, with Request changes beside it, which asks for a comment), and Publish is drawn held with the stage and who it waits for until the part is approved. A line under the title says where the document stands, a live page whose changes wait in review says readers still see the published version, the side panel gains a Review section (stage, assignee with a way to assign, due date, last move), and the Languages panel names each language's stage. In "Choose what to publish", a "Ready to publish?" list names what holds each chosen part (not approved, a required field missing) with its fix or who can unblock it, and holds Publish until nothing does; a person allowed to publish without review is offered it, with a required reason sent on the publish. Nothing changes where no workflow is attached.
