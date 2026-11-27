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

Core gains one small AI contract, `nextly.ai` (`@experimental`): run a task, stream its text, embed text, report the status, and hear one usage event per run inside the site's own process. It holds no provider code, model names or keys; a package provides AI through the "ai" capability, and boot refuses one that contributes no `ai` service. Sites see nothing new: with no AI package, the status says AI is not configured, every run is refused with how to set it up, and the admin draws no AI control. Setting `NEXTLY_AI_DISABLED` in the environment does the same without touching any AI setting.

Three permissions are seeded on new and upgraded sites: `use-ai`, `run-bulk-ai-jobs` and `manage-ai-settings`. Super-admins and Admin hold all three, Editor and Author hold `use-ai`, Viewer holds none, and roles you made yourself hold none until granted. The names `ai`, `bulk-ai-jobs` and `ai-settings` are now reserved system resources, so a collection or Single with one of those slugs must be renamed. `nextly.ai` calls are checked unless the call passes `overrideAccess: true`. `GET /api/ai/status` answers any signed-in caller, about one piece of content when given `?collection=` and `?id=`. Stored permission rows may now carry the actions `use` and `run` (the published `PermissionSchema` reads them); the list of actions for creating permissions is unchanged.
