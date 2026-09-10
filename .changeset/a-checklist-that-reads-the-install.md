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

The dashboard's setup checklist is answered by the server now, and shown only
while there is something left to do.

It used to derive its own steps in the browser from dashboard statistics, and
decide for itself whether to appear by reading a dismissal out of
`localStorage`. Both were wrong in the same direction. The steps were computed
in two places from the same four counts, so they could drift; and dismissal was
per BROWSER, which answers a question about a person — the same admin on a
second machine met a checklist they had already finished, and a colleague met
one reporting someone else's progress.

The host answers both. It reports which steps this reader has finished, and the
widget condition deciding whether the card is offered is DERIVED from that same
answer — so a card showing every row ticked, and a card that will not go away,
are both unreachable.

Steps are detected rather than self-reported: nothing is ticked by hand, the
install is asked. Only what can be answered about the reader is included, so an
editor is never held short of finishing by content they are not allowed to see.
The first step is complete for everyone, and truthfully so — reaching the card
means an account exists and they made it. A checklist that opens above zero is
finished far more often than one that opens empty, and that head start is worth
having only if it is true.
