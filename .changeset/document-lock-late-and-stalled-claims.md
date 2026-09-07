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
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

Close five more ways a document claim could report one thing while the server
held another, and stop aborting claims.

**Nothing is aborted any more.** A claim is not idempotent, so cancelling one
makes its outcome unknowable: it may still commit, and an aborted fetch can never
hand back the token it was given. The editor would then hold a token the server
had replaced with one it could never learn. Only the hold on the one-at-a-time
slot expires now; the reply still arrives, and a claim whose slot has moved on is
released as the duplicate it is. That converges without the server needing to know
anything about client retries.

**Intent survives the wait.** Whatever waits on the slot is remembered as an
intent rather than a flag, and a take-over whose request outlives its slot is
re-asked as a take-over. Retried as a plain claim it politely declines to displace
anyone, and the colleague keeps the document despite the click.

**A repair is queued, not dropped.** The signal that a late duplicate displaced
the live claim is an acquisition like any other, so it meets the same slot. It is
kept separately from a queued claim, because a claim is satisfied by winning the
document and a repair is not: what a repair reports is that the token just
installed may already be dead.

**A repair names the document it is for.** Two claims on different documents use
different lock keys, so a late reply for one cannot have displaced the other, and
waking it would start a claim nobody asked for.

**The confirmation timestamp never moves backwards.** Renewal replies can arrive
out of order, and an older one landing after a newer one shortened a lease the
newer one had already extended, firing the loss deadline several beats early.
**A rejection from a superseded claim is ignored.** A retry can win and the
original then fail; reporting that replaced a good claim with `unavailable` and
left it there, since renewals only move the confirmation forward. It also
requeued a take-over the retry had already satisfied, which later displaced a
colleague with no second click.

**A queued take-over survives a repair.** A win only spends the click if it
actually established possession, and a repair says the token just installed may
already be the dead one.

**`module.require` is read through the wrappers around it** — parentheses, a
cast, a non-null assertion, `satisfies` — since each reads the same binding and a
check on the receiver as written is a bypass anyone can reach by accident. And it
claims nothing when the file declares a `module` of its own, because reporting a
dependency the file never loads is the direction that makes a rule stop being
read.
