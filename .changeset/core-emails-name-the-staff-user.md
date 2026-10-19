---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
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
---

Core's own emails to a staff user now name that user on their delivery
records, by kind and id (`staff` and the user's id): the welcome email, the
password reset and the email verification. A record that names the user can
be found and erased with them whatever address it went to.

`person` on `nextly.email.send`, `nextly.email.sendWithTemplate` and a
plugin's `ctx.services.email` accepts a staff user as `{ kind: "staff", id }`
as well as a plugin-defined person, and the Direct API now forwards `person`,
which it dropped before. A send naming a staff user who does not exist is
refused with `VALIDATION_ERROR` before any provider is contacted. `person`
remains `@experimental`. Every send that names nobody is unchanged.
