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

The dashboard's "Set up your project" card is now a short checklist: a progress bar, then one line per step with a tick or an empty circle, its name and hint, and its buttons on the right, with Skip on the steps you can skip. It starts at half the dashboard's width, beside Needs attention, and can be made 66%, 75% or full width; on a phone its buttons drop under the step's name instead of the card scrolling sideways. "Fill in your Singles" lists your Singles inside its line, each with a Fill in button. Every action is a button rather than an underlined link. The card's separate collapse and dismiss buttons are replaced by Hide setup in its ⋯ menu, with Undo in the notice it leaves, and the sample-content step leaves the list once it has been answered. Core's default dashboard now places every card at half the row, so a card you cannot see, or one that is empty, never leaves a gap.
