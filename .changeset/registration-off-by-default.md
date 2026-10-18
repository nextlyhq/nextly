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
---

**Self-registration is now off by default.** The registration route refuses
every sign-up, creating no account and sending no email, unless the app turns
it on with `auth.allowRegistration: true` in its Nextly config.

Upgrading: an app whose users sign themselves up must add
`auth: { allowRegistration: true }`, or registration answers 403 "Registration
is not open." An account already registered and awaiting verification can
still complete it by its link. No migration is needed.

**A registered account never becomes the install's first administrator.**
Until now, whoever created the first account on an empty install, through
registration included, was made Super Admin. Now only an account the app
provisions itself (the setup route, the admin, or its own server code) becomes
the first administrator, and only while nobody holds the Super Admin role, so a
role-less account registered first no longer blocks it. Two accounts
provisioned at once on an empty install leave exactly one administrator, on
every database; before, both could become Super Admin.

Creating the Super Admin role from two requests at once no longer fails on
MySQL with a duplicate.
