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

Workflow steps can now be taken and review work assigned, through an experimental steps service. A step needs the permission its workflow names (or the right to edit, or to publish when it leads into a stage that allows publishing), and a refusal says which permission it needs. Only a signed-in person can approve or request changes, never an API key or trusted code acting as no one; where a step refuses self-approval, the person who brought the part into its stage, or the owner of the key that did, cannot approve it. Requesting changes needs a comment. A step is checked against the review state the person saw, so of two reviewers acting at once only one succeeds, and "all languages" moves every part it can in one go, naming the parts it left; on a collection that is not translated, it moves the document as a whole. A part can be assigned, singly or in bulk, to a person or role who can take the stage's main step, with an optional due date, and a stage's default reviewer is assigned on entry. Every step and assignment is recorded in the document's history.
