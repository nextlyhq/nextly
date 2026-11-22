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

The Colours tab has "Clean up unused…" under its filter. It lists every colour you made
that nothing on the site uses, each ticked, and "Remove N colours" removes the ticked ones
in one step. Built-in colours are never listed, and neither is a colour the page you are
editing uses, saved or not. Each colour is judged again just before it goes: one a page
started using meanwhile is kept and named with where it is used, and the rest are
removed. Undo and Redo reverse the clean-up. An author whose role may not change Design
isn't offered it.

For scripts, `POST /variables/clean-up` with `{ "ids": [...] }` (up to 50) removes each
variable on its own, with the same checks as `/variables/remove`, and answers
`{ removed, kept }`, each kept variable with its reason. It needs Design's update
permission. Removing a variable through either route now also takes it out of the
site's colour order.
