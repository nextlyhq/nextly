---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"nextly": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/ui": patch
---

The form preview is now an interactive simulation instead of a static mock.

Type into real inputs and conditional logic reacts live (the same evaluator the runtime uses), hit the form's actual submit button and the configured confirmation plays out — the success message, or an honest "the visitor would now be redirected to …". A desktop/mobile width toggle, a reset button, required markers, help text, and a note about invisible hidden fields complete it. The preview is explicit about what it is: a simulation inside the admin — nothing submits anywhere.
