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

Core gains one small AI contract, `nextly.ai` (`@experimental`): run a task, stream its text, embed text, report the status, and hear one usage event per run inside the site's own process. It holds no provider code, model names, keys or AI library; a package provides AI through the "ai" capability, and boot refuses one that contributes no `ai` service. Sites see nothing new: with no AI package the status says AI is not configured, every run is refused with how to set it up, and the admin draws no AI control.

Core registers no AI permission. The package that provides AI declares which of its own permissions stand for using AI, running bulk AI jobs and managing AI settings, and `nextly.ai` judges every call by them through the usual access checks, along with the person's right to read the content a run reads and edit where its result goes. Calls are checked unless the call passes `overrideAccess: true`. `GET /api/ai/status` answers any signed-in caller, about one piece of content when given `?collection=` and `?id=`.

`NEXTLY_AI=off` in a site's environment locks AI off for that start: the status says "turned off", every run is refused naming the lock, nothing in the admin lifts it, and every AI setting is kept.
