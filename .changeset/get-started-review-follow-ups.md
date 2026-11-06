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

The Get started card and the deprecated onboarding read are corrected in five ways:

- **The deprecated `GET /api/dashboard/onboarding` answers as it always has until it is removed.** A step whose own check failed or ran out of time is a row not complete again, and "not known" means only that the collections or Singles could not be listed. The Get started card still withholds such a step.
- **A failed sample-content load says so.** It shows its message and a Retry, instead of the controls disappearing.
- **Loading sample content, or declining it, counts as acting on the card.** A reader who finishes the last step from there is told "You're all set", and the card no longer simply goes.
- **A staged reset previews the default the reset will land on.** It includes Get started even when the reader's own arrangement holds no such card.
- **The card draws every step the server sends, in the server's order.** Runs of Singles still fold, and a step of a kind the admin does not know is drawn, not dropped.
