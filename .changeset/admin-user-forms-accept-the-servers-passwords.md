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

The admin's create-user and edit-user forms now accept exactly the passwords the server accepts. Any symbol counts, not only `@$!%*?&#.`, and a password over 128 characters is refused before it is sent. Every rule a password misses is listed, not only the first. Choosing "Set a password now" for a new user now says that they choose a new password the first time they sign in, which the server already requires.

Setting a user's password through an update (the admin's edit form, the REST route or the Direct API's `users.update`) now stores the password exactly as given. It used to trim spaces from its ends before hashing, while account creation and sign-in did not, so a password whose symbol was a leading or trailing space could not be used to sign in. The admin's edit form no longer trims it either. A value of only whitespace still leaves the password unchanged. Existing password hashes are unaffected: only passwords written from now on change.
