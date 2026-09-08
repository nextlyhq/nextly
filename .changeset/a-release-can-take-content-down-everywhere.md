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
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
"nextly": patch
"@nextlyhq/plugin-form-builder": patch
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
---

Every language of an entry can now be taken down at once, through the
collections service.

Publishing every language has been possible since i18n M7. Withdrawing them had
no counterpart at any layer — no admin hook, no route, no service method — so
there was no way to take a localized document down as a whole. An ordinary
update carrying no locale reaches the DEFAULT language only, leaving every other
translation published.

`unpublishAllLocales` closes it at the service layer. It is NOT yet reachable
from a REST route or from a scheduled release: wiring a release through it was
attempted and reverted in this PR, because the all-languages lifecycle does not
fold a pending working draft or run mutation hooks, and a scheduled publish needs
both. So this ships the missing capability and the honest boundary around it —
the localized takedown gap in Content Releases stays open until that wiring is
designed rather than inherited.

The direction is a parameter rather than a second method. Publishing every
language and withdrawing every language differ in a target status, an access
action, and whether the write can establish first publication; the other 745
lines — the access gate, the row lock, the companion sweep, the version capture,
the event fan-out, the cache flush — are the same operation. `publishAllLocales`
keeps its signature and behaviour and delegates to the shared path.

`first_published_at` is untouched by a withdrawal. It records when a document
first became reachable, which taking it down does not change; re-dating or
clearing it would make a later republish report a first publication that had
already happened.

A takedown REFUSES rather than half-performing when a collection's translation
table physically lacks its per-language status column — the state left by
enabling Draft/Published on a collection that was already localized. Publishing
into that state fails loudly and loses nothing; a withdrawal that reported
success would leave every translation readable, so this one names the
collection, explains the state, and changes nothing.

Per-language writes are unaffected, and a locale-scoped member is never widened
into a document-wide one.
