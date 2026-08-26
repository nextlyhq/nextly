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

Asking for a preview link that cannot be built now says which of seven things
is wrong, instead of telling every editor to fill in a slug.

The resolver behind preview links refuses for seven distinct reasons: the
document is confirmed gone, the document could not be READ at all, the collection
declares no preview, the declaration yields no address for this document yet, the
declaration FAILED while running, the address it yields is on a different site,
or it does not parse. All of them arrived as
one message — "this entry has no preview address yet, so filling in the fields
its preview URL is built from — usually the slug — makes it shareable." For most
of them that is wrong and unactionable. An editor whose slug was already correct
was sent to look at the one field that was not the problem, and a preview URL
pointing at another origin is something no field on the entry can change.

Each refusal now names its own remedy and the person who can apply it — a
missing declaration is a developer's job, an empty slug is the editor's, and a
foreign origin belongs to whoever owns the preview URL or the site URL setting.

**A failed read is no longer reported as a deletion**, and that pair is worth
calling out because the two diagnoses are opposites. A transient database error,
a rate limit, or a throwing read hook establishes nothing about whether the
document exists — so the read reports absence only on a 404, and anything else
now says "could not be read just now, please try again in a moment" rather than
telling an author their work may have been deleted while it sits there intact.
Reads that report failure by throwing rather than by returning an envelope, which
is how the Direct API answers for Singles, are translated the same way.

**The public preview route is deliberately unchanged and still answers all seven
with the same 404.** That is not an oversight: distinguishing them there would
let a stranger holding a forged token tell a deleted entry from an unpublished
one from a collection that has no preview, which is an oracle for what exists in
draft. The reasons are surfaced only on the authenticated path, where the caller
already holds edit access on the document and learns nothing by being told —
enforced by a capability the anonymous path cannot construct, rather than by a
comment asking callers not to. The route's answer is DERIVED from the detailed
one in a single place rather than computed alongside it, so the two cannot drift
into disagreeing about when to refuse.
