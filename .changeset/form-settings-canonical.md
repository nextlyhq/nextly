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

Form settings are one honest shape, and every setting shown now does something.

**One canonical shape.** The builder previously saved settings keys the collection schema never declared, while the schema declared keys the builder never wrote. Now there is one `FormSettings` (the message-vs-redirect confirmation radio included), one reader (`normalizeFormSettings`) that every consumer goes through, and migration-on-read for legacy keys (`confirmationMessage` becomes the success message; the old nested `captcha` object becomes the flat fields) — saved forms lose nothing.

**Settings that do things.** "Allow multiple submissions" is now real: turn it off and the same visitor (by IP) can submit once, with an honest "You have already submitted this form." on repeats. The per-form honeypot and reCAPTCHA toggles are now real overrides of the plugin's global spam config — tri-state selects where "Inherit" shows what the plugin default actually is, and the form wins where set.

**Settings that did nothing are gone.** `showResetButton`, `resetButtonText`, `storeSubmissions`, and `submissionLimit` had no consumer anywhere; they no longer appear in the UI or the shape.
