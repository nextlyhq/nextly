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

An author who opened a document somebody else was already editing had exactly
one thing they could do about it: take the document over, displacing a colleague
mid-sentence. The polite option was to close the tab and hope.

The lock strip now offers "Request edit access" beside "Take over", and the
holder is told — passively, in the same strip — that someone is waiting. Nothing
else changes: the request moves no claim, asks the holder for no answer, cannot
be refused, and the lease expiring stays the only thing that transfers a
document. Every action the holder had, they keep, including the Save they are
being given time to reach.

The ask is a standing one rather than a single message. The editor that is
locked out is already polling for the document on every beat, so the request
rides that poll and is re-stated for as long as the person is still there and
still waiting. Close the tab and it lapses, so a holder is never nudged on
behalf of a colleague who has gone.

Pressing the button is answered. The strip replaces it with "We have let Bob
know you are waiting" — text, not a disabled button, because a control that
stays on screen having stopped doing anything is what a broken one looks like.
The confirmation is shown only when the SERVER has the ask on record, so a
request that landed nowhere cannot be reported as delivered.

The holder's notice is a `status` region and not a dialog. There is no APG basis
for one here — that pattern is for urgent interruptions a person must answer —
and it is spoken once when it appears rather than on every heartbeat.
