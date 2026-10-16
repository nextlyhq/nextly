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

**Breaking (`@nextlyhq/plugin-form-builder`):** the plugin no longer has webhook senders of its own. Nothing called them; a submission reaches other systems through Nextly's `form.submission.created` webhook.

Removed exports: `triggerWebhooks`, `fireWebhooks`, `isValidWebhookUrl`, `getSupportedWebhookEvents`, and the types `WebhookPayload`, `TriggerWebhooksOptions`, `WebhookDeliveryResult`, `TriggerWebhooksResult`, `WebhookConfig` and `WebhookEvent`.

Removed option: `notifications.webhooks` on a form config, and `webhooks` on `FormDocument`. The plugin never read it, so it sent nothing. A config that still sets it now logs a warning naming the replacement, from `createFormConfig`, `applyFormDefaults` and `validateFormConfig`. Stored forms are not changed.

To be told about new submissions, subscribe an endpoint to the core event instead. There is no replacement for `submission.updated` or `submission.deleted`: the submissions collection sends no events when a submission is edited or deleted, because they would carry its answers.

```ts
// Before: accepted, and never sent
createFormConfig("contact", fields, {
  notifications: {
    enabled: true,
    recipients: [{ email: "team@example.com" }],
    webhooks: [
      { url: "https://crm.example.com/hook", events: ["submission.created"] },
    ],
  },
});

// After: an endpoint on Nextly's webhooks (admin, Settings → Webhooks), subscribed to
// `form.submission.created`. Its payload names the submission (`resource.id`); read the
// answers over REST: GET /api/collections/form-submissions/entries/{id}
```
