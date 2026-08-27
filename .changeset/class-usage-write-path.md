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

The page builder can now bring a written document's whole class-usage record into agreement
with it in one pass.

Maintenance already reconciled ONE subject against ONE document. A save owes an update to
several: the index is keyed by document CROSSED with a locale and a variant, and the hook that
will drive this is not told which of those was written. `_status` is stripped from the payload
before a hook sees it, and the write locale is known at the call site and never forwarded. So
"reconcile what changed" is not expressible, and every subject the document owns is
re-derived instead. That costs a read per subject on a save that touched one of them, and the
alternative is leaving a stale subject behind - which is the state that makes a class a page
still renders read as unused.

A collection this index does not track costs nothing and reads nothing: no blocks field means
no subject, so the walk does not run. The filter reads the configuration handed to it rather
than a list captured when the plugin was wired, so a collection created afterwards is tracked.

Nothing here throws. Collection `after*` hooks run once the write has COMMITTED, so raising
would report a failed save for a document already on disk - the author is told their work was
lost when it was not. Every failure is captured and reported instead, per subject. An index
that disagrees with a document is recoverable by a rebuild; a false error is not recoverable
at all.

One subject's failure does not stop the others. Their rows are independent, so stopping would
leave every later subject stale as well as the failed one, turning one recoverable
disagreement into several - and reconciliation is idempotent, so a rerun repairs whatever a
pass could not.

A document that is ABSENT in one locale and variant is left alone rather than reconciled
against nothing. Absence is ordinary: a collection with drafts holds a published row for a
document with no pending draft, and a localized field has no value in a locale nobody has
translated. Reconciling would delete that subject's rows. Removing rows for documents that
are really gone belongs to the rebuild's sweep, which can tell those apart and this cannot.

The document behind each subject is obtained through an injected reader rather than reached
for here. The subject names a locale and a variant, and how those are addressed is a property
of the runtime the caller is in - and it keeps this half testable against values.
