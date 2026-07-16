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

Stop a custom user field from displacing a built-in one, and fix a field's name and type once it exists.

**A custom user field named `email` replaced the real email address, and one named `id` replaced the identity used to create the session.** Custom fields live in their own table, but they are assigned onto the user object _after_ the built-ins, so the custom value wins. The same order applies to validation: a custom text field named `email` turned the built-in `z.string().email()` into a plain optional string, so a user could be created with an invalid address or none at all. Password checking was never affected — the hash is read by a separate query that custom fields cannot reach — but anything reading `user.id` from the object returned after sign-in was.

`defineConfig()` has always refused these names. Nothing else did: the admin, `POST /api/user-fields` and `PATCH /api/user-fields/:id` all reach the same service, and it checked only that the field was not code-defined. The one check on that path ran in the browser and was skipped when editing. **Creating or renaming a field to any built-in name is now refused wherever the request comes from**, and the message says which name and why. `defineConfig()` and the API now share one implementation, so the two lists cannot drift apart.

**If your database already has such a field, it stops being applied on the next boot** and Nextly logs which field it dropped. The row is left alone so you can rename it by hand. This is a behaviour change: a field named `email`, `id`, `name`, `isActive`, `passwordHash`, `roles` or any other built-in name will disappear from your users' data until it is renamed — it was displacing a built-in rather than sitting beside it.

**A field's name and type can no longer change after it is created.** Both name the database column, and Nextly's schema reconciler only adds columns — so renaming left the old column and everything in it stranded under the old name, and changing the type left the column at its original type. The admin now says so under each field rather than only greying the input out, and label, description, placeholder, default, required and active all stay editable. Sending a name or type back unchanged is still accepted, so existing clients that submit a whole field keep working. Directus locks field keys for the same reason; Strapi renames and loses the data.

Also in this release: **Nextly now has browser tests**, run in CI against a real server and a real database. They cover what unit tests structurally cannot — rendered layout, contrast, and whether the admin boots at all — and they caught nothing new, which is the point: they are there so that the column-width and contrast regressions fixed in the previous release cannot come back unnoticed. Contributors can run them with `pnpm --filter @nextlyhq/e2e test:e2e`; see `e2e/README.md`. This changes nothing about how you use Nextly.
