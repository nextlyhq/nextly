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

A plugin is told of each change of its own queued emails inside the transaction that makes it, through `ctx.services.email.onQueuedEmailChange`: an attempt starting, a failure a retry can help, sent, failed, or cancelled with why (a person, the plugin itself, or a request made while an attempt was with the provider). Each change lists every recipient the send went to after `email.beforeSend` filters, with its line, what became of it, a masked hint and the plugin's own rotation-stable digest; no address. `readQueued` reads where the plugin's own queued emails stand, and `recipientDigest` gives the digest for an address.

Sends and queued sends take `excludeRecipients`, a list of those digests, compared after the filters run: the recipients it names are left out, and when no `to` is left each remaining copy gets a message of its own. People cancel a queued email with `nextly.email.cancelQueued`, which asks the new `manage-email-deliveries` permission of a checked call.

Migration: `manage-email-deliveries` is seeded on the next start, granted to super-admin only, under the newly reserved system resource `email-deliveries`: an installation with a collection or Single of that slug must rename it. No table or column changes.
