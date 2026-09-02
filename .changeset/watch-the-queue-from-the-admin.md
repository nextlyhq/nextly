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

Background jobs are visible in the admin, under Settings.

A job that fails is invisible. There is no request to inspect, no status code
and no page that went blank, so a scheduled release that did not publish looks
exactly like one that was not due yet. `GET /api/jobs` made that readable; this
is the screen that reads it.

Read-only, and that is the design rather than a first step. Retry, cancel and
requeue are writes on already-authorized work, each needing its own decision
about who may perform it, and offering them beside a read would settle those
questions by omission.

Failures are stated ABOVE the table, because the question that brings someone
here is almost always "did the thing I expected happen", and a red row twelve
lines down is a worse answer than a sentence at the top. The notice is its own
component and fetches and authorizes for itself, so a release or a webhook page
can mount it beside the object whose work failed by adding one element. It stays
silent when nothing failed, when the window is still loading, and for a viewer
who may not read jobs — a notice that appears routinely is one its reader learns
to skip.

A retrying job is deliberately not presented as a failure. It is the system
healing itself and needs nobody; colouring it like a dead job is the documented
mistake in queue tooling, which raises an alarm for the harmless case and buries
the one that matters. `failed` is the only red pill on the screen.

Two sentences keep the screen honest. It says when the window is truncated,
because otherwise fifty rows read as the whole story. And it states the
seven-day retention, because a list that silently forgets is one an operator
reads as proof a job never ran.

The grants that reveal the Settings panel are now read off the panel itself.
A capability list decides whether the rail entry appears at all, separate from
the gate on each destination inside it, and it was maintained by hand beside the
navigation table — so Background Jobs was added to one side only, its own gate
passed, and an operator holding just `manage-background-jobs` was stopped by the
rail above it, with the page reachable solely by typing its URL and nothing
erroring to say so. The list is now derived from the navigation, so a
destination added to the panel reveals it by construction and the same omission
cannot be made twice.

Two enumerations of the Settings panel became one. Whether the rail entry
appears and whether `/admin/settings` opens at all were each maintained by hand
beside the navigation table, so Background Jobs was added to the panel and to
neither — and fixing only the first produced a rail entry that led to a page
which turned the operator away. Both now read the table, so a destination added
to the panel is both visible and reachable by construction.

The failure summary asks the SERVER for one task's jobs. It was fetching the
global recent window and filtering it, which filters rows a busier task has
already crowded out: mounted beside a release, it would have stayed silent about
that release's failure whenever webhook deliveries were noisier. The endpoint
takes a `slug` and narrows in the query, before the limit.

Which statuses need attention, and which stored states express them, are one
declaration. A predicate saying "this needs a person" and a list saying "select
these rows" are the same decision at two layers, and written separately they
agree only until a second actionable status is added — at which point the list
goes stale and the database discards the new failures before the predicate can
see them. The list is now computed from the same table the predicate reads, and
a test derives that table from the status function rather than trusting it.

An unknown job state is refused rather than dropped. Dropping looks
conservative and inverts the request: with every name dropped the filter
disappears, so `?state=faield` returned a successful read of every state — the
widest possible answer to a request for a narrower one.

Job timestamps render through the admin's configured formatter. An installation
sets a timezone and a date format; a local `toLocaleString` reads the browser's
instead, so the same instant appeared two different ways on one page and nothing
said so.

The table narrows on the SERVER too. Once the summary started asking the
database for failures, a locally-filtered table could show nothing under a
notice reporting one — the two halves of one screen disagreeing, because only
one of them had asked. Choosing a status now sends the stored states that can
produce it, and the client separates only the statuses that share a state.

"Needs attention" is total over wire strings. A newer server can send a status
this build has never heard of, which `jobStatusPresentation` already degrades
for; the predicate indexed its table directly and threw on that key, taking down
the page whose job is to report that something is wrong. It answers false for an
unfamiliar status, so the summary keeps two rules rather than one: a status the
core calls actionable is kept, and so is one this build does not recognise —
because the rows a stale client would otherwise drop are exactly the new kind of
failure nobody has seen yet. What it drops is only what it knows to be quiet.

A failed job is described as terminal, not as having spent its attempts. The
runner returns terminal immediately when the identity it would run as is gone,
so a job can reach that state on its first attempt, and telling an operator the
retries were exhausted sends them looking for a backoff that never happened.

An expanded error keeps an operable label. Hiding every child of the disclosure
on open left an empty control — nothing to click to collapse it and nothing for
a screen reader to announce.

It also asks for FAILURES rather than sifting recent rows. A window is the most
recent N jobs, so N healthy ones running after a failure push it out — and a
summary that looked inside that window would report nothing wrong with the
confidence of a check it never performed. The endpoint takes stored states, and
the core publishes which of them need attention.

A long error is readable without a mouse. A clipped line with the full text in a
`title` is unreachable on touch, which is where a queue often gets checked; a
long error is now a native disclosure, operable by pointer, touch and keyboard.

A failed read no longer looks like a healthy queue. When the request errors
there is no data, and rendering nothing there is exactly what "nothing failed"
renders — telling an operator that nothing needs attention when the truth is
that nothing could be checked. It now says the queue could not be read.

Retention is presented as the DEFAULT, not as the installation's policy. A host
passing `retentionMs` to `runJobsPass` keeps rows for another period, and `null`
disables pruning entirely; nothing on the read path can see which was chosen, so
a flat "removed after 7 days" is a claim the screen cannot support — and this is
the sentence operators are meant to trust about absent rows. The number itself
now comes from the core's own constant, moved to a leaf module so a client
importing it does not pull the Direct API graph along with it.

"Needs attention" is asked of the core's `jobNeedsAttention` rather than
compared against `failed` here, so a second actionable terminal state cannot be
silently omitted from the notice while the exhaustive presentation map goes on
compiling.

A due time reads the schedule as well as the retry. `runAt` is when a job asked
to run and `nextAttemptAt` is when a failed one will try again; reading only the
second showed a dash for a scheduled release, which is the case that brings
someone to this screen.

The failed-job reason stays in the narrow render. `hideOnMobile` removes a
column from the card view rather than truncating it, so marking the error text
that way left a phone showing that a job failed with no way to read why.

The status vocabulary is imported from the core rather than restated. `nextly`
now publishes `nextly/api/jobs-list-types`, and the wire item is DERIVED from
the row the route emits, so a field or a status added on the server reaches the
admin's types without a second edit — and an unfamiliar status still renders
verbatim rather than blank, for a server ahead of the client.
