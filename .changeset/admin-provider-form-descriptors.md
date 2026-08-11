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

The provider screens also tell a catalog that could not be loaded apart from
one that merely could not be refreshed. A failed refresh keeps the descriptors
already fetched, so the type filter, the row labels and the form all still work
from them; the pages now say so instead of reporting the catalog unavailable,
and the edit page's Update button follows the form into read-only when the
cached catalog no longer lists the stored type.

Promoting a provider to default is one transaction. The demotion of the previous
default and the write that promotes previously committed separately, so a
promotion that matched nothing — a row deleted between the read and the write, an
insert the database refused — left the installation with no default provider at
all and nothing in the trail to say why.

Inside that transaction the demotion runs first. PostgreSQL carries a partial
unique index over `is_default = true` and checks it as each statement runs, so a
row taking the default while the incumbent still holds it is rejected outright.
A promotion that then matches no row — because the provider was deleted in the
meantime — throws rather than commits, which takes its own demotion back with
it.

A masked value is no longer written back over what it stood for. The read masks
a configuration path the provider does not describe — a credential left behind
by an upgrade, say — while the write stripped masks only from paths declared
secret, so a client echoing the configuration it was given replaced the real
stored value with eight bullet characters during an unrelated edit. Masking and
unmasking now ask one question.

Only a handover opens a transaction. Wrapping every provider write in one cost
correctness on SQLite, where the transaction is `BEGIN IMMEDIATE` on a single
shared connection: a second ordinary write arriving while the first was open
could not begin at all.

An edit form left open reconciles a newer version of the record it is showing.
The detail query refetches on focus, so a change made elsewhere used to be held
and written back on the next save, reverting it from an edit that never touched
those fields. Fields the operator has touched keep what they typed. If the
record's TYPE changed, the configuration is rebuilt from the new provider rather
than carried across — otherwise one provider's credential is submitted as
another's wherever both declare the same field name.

A stored value that predates a tightened constraint no longer blocks unrelated
edits. A provider upgrade that lowers `maxLength`, or narrows a numeric range,
made every provider holding an older value unrenameable and undeactivatable. The
provider's own parser stays the authority on what it accepts; the descriptor
governs replacements.

Provider metadata that no descriptor can publish is refused at registration
rather than at the first request for the catalog: `options` that is not an array
of `{ value, label }` on any field kind, two select options sharing a value, and
`capabilities` given as an array. One malformed provider previously took the
whole catalog endpoint down, and with it every provider's form.
