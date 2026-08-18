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
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

**Breaking for SMTP users:** `nodemailer` is now an optional peer dependency. If you send email over SMTP, run `npm install nodemailer`.

It was a hard dependency of `nextly`, so every install carried roughly 676 KB for a transport most installs never use, and it is the mail dependency with the most security churn. Installs that send through Resend or SendLayer, or that send no email at all, no longer download it. The SMTP provider, its settings form and its connection test are unchanged, and a stored SMTP configuration keeps working once the package is present.

Three things make the absence explain itself rather than surfacing as a failed password reset. A send names the package and the command instead of reporting a module-not-found. The server logs one warning at boot when a stored provider cannot run. The provider settings form shows which package is missing, the exact command, and a link to its documentation, and still lets the configuration be saved.

Email now also sends to the server log when no provider is configured at all, instead of failing. A fresh install threw a 422 on its first send, which is the password-reset flow, so a new install could not complete the first thing a user does after signing up. Outside production the rendered body is written too, so a developer can follow a reset link; in production only the recipient and subject are recorded, because reset and verification bodies carry live tokens. Mailpit remains the recommended local inbox and is unaffected.

Email provider descriptors now report whether the install can actually use each provider, so a plugin that needs a package the host has not installed can say so in the admin rather than being offered and failing when a message is sent.
