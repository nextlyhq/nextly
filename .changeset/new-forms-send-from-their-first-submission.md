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

Forms now bring two starter emails to Settings › Email: "Form submission", which lists every answer by its label for your team, and "Form confirmation", which confirms to the visitor that their submission arrived. A new notification starts on the team's email, and switches to the confirmation when it is sent to the visitor, so a new form sends from its first submission instead of waiting for someone to write an email. Templates also receive `_submission.answers`: each answer's label and value, a choice by its option's label, leaving out questions left blank or hidden by a condition. A submitted field's own value is never replaced by these variables.

A notification saved earlier without an email keeps sending nothing until you choose one: its editor now offers the matching starter in one press.
