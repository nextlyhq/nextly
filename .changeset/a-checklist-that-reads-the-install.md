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

A transient card can now name SEVERAL conditions, and is offered only while
every one of them holds.

The get-started card needed two, and neither answers alone: is there nothing to
look at, and is the offer of demo content still open. Declining that offer
creates no content, so the card kept its slot on the strength of the install
still being empty — visible, drawing nothing, for a reader who had already said
no. The two conditions are scoped differently on purpose: whether there is
content to see is about the reader, while whether a project took the demo data
is recorded once for the project, so a second admin is not offered it again
after the first declined.

The dashboard's last browser-stored dismissal is gone with it. A hook that
derived onboarding steps in the browser and remembered dismissal in
`localStorage` had no consumer left once the host started answering, and the
types beside it described a checklist that no longer exists — including a step
vocabulary listing five names none of which are detected any more.
