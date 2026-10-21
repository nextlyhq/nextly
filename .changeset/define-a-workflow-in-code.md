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

An editorial workflow can now be defined in code and attached to collections and Singles, from `nextly/config` or `nextly`. `defineWorkflow` declares its stages (one or more allowing publishing), its steps between them (`submit`, `approve`, `request-changes` or `move`, each with its permission, comment rule, self-approval rule and primary step), what an edit to approved content does, where the next draft starts after publishing, where removed stages go and whether approvals survive a change of definition. `reviewWorkflow()` is the one-line Drafting → In review → Approved preset. A collection's or Single's `workflow` option attaches one; it needs `status: true` and drafts enabled, and a workflow on anything that cannot keep a draft beside the live version is refused at config load, at boot and in `nextly build`, saying which condition is missing. Every definition is validated when declared, with errors that name their place and the known names (``steps[1].to: `aproved` is not a stage. Known stages: drafting, inReview, approved.``), and a misspelt stage in a step fails to compile.

Each registered workflow carries its definition hash (sha256 of its structure; labels and attachments do not change it) and the path of the `nextly.config.ts` that registers it, and the generated types gain a `<Name>WorkflowStage` and `<Name>WorkflowStep` union per attached collection and Single, with a `workflows` entry in `Config`. Nothing changes at runtime yet. The internal `defineWorkflow` for content states in `lib/content-states`, which was never exported, is renamed `defineContentStates`. All of this is experimental.
