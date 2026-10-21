---
"nextly": patch
"@nextlyhq/plugin-accounts": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/plugin-mcp": patch
"@nextlyhq/ui": patch
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-form-builder": patch
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

An email template's Reply-To and the display name of its From can now follow
the send's variables: a Reply-To of `{{ customer.email }}` answers the person
an order is about, and a From of `{{ shopName }} <orders@shop.example>` names
the shop. The From address stays fixed: a variable in it is refused on save. A
send whose rendered Reply-To is not exactly one address (a display name is
allowed, a list is not) fails before any provider is asked, as not retryable,
naming the Reply-To; one that renders empty sets no Reply-To. The send's own `from` and `replyTo` still win over the
template's, and a From or Reply-To that uses no variables is sent exactly as
before.

Templates can copy fixed addresses on every send: `cc` and `bcc` on a
template are added after the send's own copies, leaving out any address the
send already reaches. Only fixed addresses are accepted, never variables. They
can be set through the REST routes, the standalone `nextly/api/email-templates`
handlers and the Direct API, and a change to them is recorded in the activity
log by field name only.

A template's owner can mark it as carrying a secret (`carriesSecret` on
records). Such a template refuses `cc` and `bcc` on save, and sends none
even when they are stored on it some other way. Core marks its password reset,
email verification and welcome emails; the accounts plugin marks its
verification, reset and address-change emails. The mark is the owner's and
cannot be changed from the admin or the API.

Core's templates and layout, and the accounts plugin's templates, now say
when each is sent (`description`).

`contributes.emailTemplates` entries accept an optional `carriesSecret` and
`replyTo` (both `@experimental`). A plugin should mark every template that
carries a sign-in, reset or verification link or code.

`EmailTemplateRecord` gains required fields (`cc`, `bcc`,
`carriesSecret`). Code that builds one itself, such as a test fixture or a
mock of the template service, needs to set them. `email_templates` gains the
nullable columns `cc`, `bcc` and `carries_secret`, added in place on every
dialect. Nothing an existing site sends changes on upgrade.
