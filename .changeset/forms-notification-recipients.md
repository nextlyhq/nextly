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

Form notifications can send to several team addresses (`recipients`), send only when all or any of several conditions hold (`conditions: { match, list }`), and choose which of the form's file fields they attach (`attachFields`). A notification saved before these reads and sends exactly as it did: its single address and single condition read as lists of one, and it attaches the file fields marked to attach to notification emails. `FormEmailNotification.to` is a list for an email with several recipients and stays a string for one, and each email carries its own `attachments`.

In the admin, Notifications becomes a list with an Active switch per notification, and each notification opens on its own page (`?notification=<id>` on the form's Notifications page). **Add notification** offers two presets, "Notify your team" and "Confirm to the visitor". The file field's "Attach to notification emails" switch moves to each notification's "Attach files from" choice; a field's stored switch stays what a notification saved before attaches.
