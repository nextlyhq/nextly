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

The types the template ownership methods take and return are now exported from
`nextly`, so code calling `nextly.emailTemplates.override`, `reset`, `compare`,
`applyUpdate` and `undoUpdate` can name them: `OverrideEmailTemplateArgs`,
`ResetEmailTemplateArgs`, `CompareEmailTemplateArgs`,
`ApplyEmailTemplateUpdateArgs`, `UndoEmailTemplateUpdateArgs`,
`EmailTemplateComparison` and `OwnerUpdateUndo`, with the types their fields
are built from, `EmailTemplateVersion`, `OwnerChange` and `OwnerChangeChoice`.
They are `@experimental`, as the methods are.
