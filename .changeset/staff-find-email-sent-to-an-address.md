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

Staff can find what was sent to one exact address.

- **Search:** `POST /api/email-deliveries/search` (Direct API: `nextly.emailDeliveries.search({ address })`) lists the deliveries of sends that weren't queued, and the queued emails, that went to one exact address. It answers in the merged Activity's form, under its cursor (`before` / `meta.nextBefore`) and with its filters. The address goes in the JSON body. A URL carrying `address` is refused.
  - It matches the address's keyed digest under `NEXTLY_SECRET` and each secret still listed in `NEXTLY_SECRET_PREVIOUS`. Only a whole address matches, however it is cased or written (`Name <address>` included). Any address the send path accepts can be searched, a quoted local part included. Records written under a secret no longer configured can't be found. Every answer carries a `notice` saying so.
  - It needs `read-email-deliveries`. The address is never stored, logged or returned.
- **Recorded:** each search is written to the activity log as `action: "read"` under `email-deliveries`, by whoever searched, with only how many records it found. The search fails if that entry can't be written. On the Direct API, a search must name the `user` making it. A call that names no one is refused with `VALIDATION_ERROR`, and so is a key the Direct API knows no id for.
- The merged Activity (`/activity`, `nextly.emailDeliveries.activity`) and the search read their queued emails and their deliveries from one snapshot. An email settled or pruned while a page is read appears once, never twice and never not at all.
- A failed search's error and log lines carry nothing of its query: no address and no digest of one.

Compatibility: the activity log can now hold the action `read`, alongside `create`, `update` and `delete`. Code that reads activity-log rows and expects only those three must allow it. The search is `@experimental`.
