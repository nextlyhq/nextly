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

Publishing a page says whether its components are live.

A page and the components it embeds are separate documents with separate
lifecycles, so publishing the page said nothing about them. The page then drew a
missing-component marker exactly where the author expected content, and the save
reported plain success.

It now reports. Publishing still succeeds — publishing a page before its
components is an ordinary order of work, and refusing it would block a
legitimate sequence to prevent a state the author is about to leave anyway — and
the response carries a notice saying how many embedded components are not live.

Which states count as published is not decided a second time. The check reads
the component store under a published scope and treats the ids that do not come
back as the answer, so the query service keeps owning a rule a project can
extend with public states of its own. That also collapses two cases worth
collapsing: an unpublished component and a deleted one leave the same hole, and
the author's next move is the same for both.

It stays silent where it cannot decide. A localized component store publishes
per language on a companion row, so a published-scoped read answers for no
language in particular and would report live components as missing; a notice
that fires on a case it cannot decide is one authors learn to dismiss. It also
declines inside a caller-owned transaction, where it would read a database that
does not yet contain the write it was called for.

The condition is the state the write LEAVES BEHIND rather than the transition
into it, so dropping an unpublished component into an already-live page reports
too — the case a publish-time-only rule would miss.

Warnings now carry a severity. A post-commit hook could already tell a caller
that a side effect broke, by raising; there was no way to say something true
about a write that succeeded, and an advisory sent through the failure channel
arrives wearing a failure's code. Both travel in one array because they are one
question to a consumer, and the admin reports them differently: a save with only
an advisory is no longer phrased as though something failed, and a real failure
still owns the headline while the advisory travels beside it rather than being
dropped. Anything not explicitly marked an advisory is treated as a failure, so
a server that never sends the field cannot have its failures downgraded into
reassuring language.

The notice offers no action yet. Publishing the components alongside the page is
a separate capability, and copy promising an affordance nobody can reach is
worse than copy promising nothing.
