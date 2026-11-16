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

Form bot checks are verified on the server. A form's bot check (Site default, Off, Google reCAPTCHA v3 or the new Cloudflare Turnstile) sends its token inside `data` as `g-recaptcha-response` or `cf-turnstile-response`, and the token is checked with the provider before the submission is accepted, wherever it is written. Keys go in the plugin's `spamProtection.recaptcha` / `spamProtection.turnstile` options, which are validated at start.

- A token that fails, or a missing one, stores the submission flagged as spam.
- A provider that cannot be reached leaves it unchecked, and logs a warning.
- A form whose check has no secret key keeps accepting submissions unchecked, with a start-up warning and a note in Settings. Settings no longer lets a check without keys be newly chosen.
- Settings shows the plugin's rate limit, read-only.
- The public form read gives a visitor's form `botCheck: { provider, siteKey, field }` to render the widget with.

Forms saved before keep their protection. The previously unused `recaptcha` option of `checkSpam`'s config is deprecated, and `SpamCheckResult.reason` gains `"turnstile"`.
