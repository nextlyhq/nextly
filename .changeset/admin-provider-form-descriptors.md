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
---

admin: render the email provider form from the server's provider descriptors

The provider form no longer knows any provider by name. It fetches the
registered types and their field metadata from the server and builds the
picker, the controls and the client-side validation from that, so a provider
contributed by a plugin is configurable in Settings without editing the admin.

Dotted field names are treated as paths, so a provider declaring `auth.pass`
stores `{ auth: { pass } }`, and a credential the user did not touch is
omitted from the update rather than overwritten with the mask that stood in for
it. A provider whose plugin has been removed renders read-only with its type
named instead of as a blank form.

Also fixes the Active toggle on the edit page, which was rendered and then left
out of the update payload, so pausing a provider silently did nothing.

nextly: record who created, changed, promoted or deleted an email provider

`email_providers` holds the credentials that send password-reset and
verification mail, so an actor who can edit a provider can point every
authentication email at a relay they control. That action previously left no
record. Create, update, delete and promote-to-default now write an activity
entry naming the actor, the provider and which fields changed.

Names, never values: an entry carries no part of the configuration, and a
configuration change is recorded as the single field name `configuration`
rather than by its inner paths. An update that moved nothing writes no entry
at all.
