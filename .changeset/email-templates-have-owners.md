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

Every email template now has an owner: Nextly for its built-in templates and
layouts, a plugin for the templates it contributes, or the site for the ones it
makes. Records from the Direct API and REST carry `owner`, `overridden`,
`ownerChanged`, `setInCode` and `description`.

An owner's template follows the owner. Plugin and core templates used to be
inserted once and never touched again, so a plugin could not ship a fix to its
own email. Now each boot stores the owner's current version, unless the site
has overridden the template. An override keeps the site's version and a copy of
the owner's version it started from; when the owner later changes, the
template reports `ownerChanged`, and `compare` lists each change on its own,
with the site's lines beside it and a `review` token. `applyUpdate` takes that
token and a choice per change (keep the site's lines, use the owner's, or use
edited text) and applies them together, refusing once anything it compared
has moved, returning what it replaced so `undoUpdate` can put it back. `reset`
returns the template to its owner's version. Changing an owned template's
subject, preheader, HTML, plain text, description or declared variables
through `update` overrides it, so an
edit is never overwritten at the next boot. New REST routes:
`PATCH /api/email-templates/:id/override`, `/reset`, `/apply-update` and
`/undo-update`, and `GET /api/email-templates/:id/compare`.

A send now uses the site's override first, then the site's code version from
`email.templates` in `defineConfig()`, then the owner's version. Before this,
a stored template always won, so a configured `email.templates` function was
never used on a new installation. Whichever version sends, the stored
template's provider, From, Reply-To and attachments apply.

Nothing an existing site sends changes on upgrade. A stored core or plugin
template that differs from its owner's version is kept as an override. A site
that configures `email.templates` keeps sending the stored template it sends
today, as its override, until it is reset. Templates of a plugin that is no
longer installed are kept and can be deleted. Core's templates and an installed
plugin's can no longer be deleted (the delete used to be undone at the next
boot); reset them instead. A template's name and whether a layout wraps it are
the site's and are kept. Declared variables and descriptions are taken from
the owner at the upgrade: they never change what is sent (a missing required
variable only logs a warning), and stored declarations are mostly an earlier
release's.

`contributes.emailTemplates` entries accept an optional `description`.

`EmailTemplateRecord` gains required fields (`owner`, `overridden`,
`ownerChanged`, `setInCode`, `description`). Code that builds one itself, such
as a test fixture or a mock of the template service, needs to set them.
