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
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
"nextly": patch
"@nextlyhq/plugin-form-builder": patch
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
---

A plugin author can now name the types their dashboard widget receives, and the server, the admin and every plugin share one definition of what a widget query answers.

`@nextlyhq/plugin-sdk/widgets` publishes `WidgetComponentProps` — the five props a widget component is handed — alongside the wire shapes `WidgetSlot`, `WidgetResult`, `WidgetResultField` and `WidgetQueryBatchResponse`, which `nextly/widget-result` now exports from the module that declares them. Both are leaf entries carrying no runtime, so importing a type pulls no code. Until now those shapes were declared three times — by the endpoint that sends them and again by the admin that draws them, with the admin's copy the stricter of the two: it promised readers that a successful slot carries a result and a failed one carries a reason, while the server's own type required neither. The endpoint now declares that union itself, so the compiler holds it to the guarantee its consumers were already relying on.
