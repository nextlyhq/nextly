---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"create-nextly-app": patch
"nextly": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/ui": patch
---

Forward `cc`/`bcc` consistently across every email send path.

`nextly.email.send` and `nextly.email.sendWithTemplate` (Direct API) now accept and forward `cc`/`bcc` — they are added to `SendEmailArgs` and `SendTemplateEmailArgs`. Previously the Direct API namespace silently dropped both fields, so only the REST route (`/api/email/send-with-template`) honored them. `EmailService.sendWithTemplate` also dropped `cc`/`bcc` on its code-first template fallback branch while the DB-template branch already forwarded them; both branches now forward them. Empty `cc`/`bcc` arrays are not forwarded, so they don't override the "no options" path.
