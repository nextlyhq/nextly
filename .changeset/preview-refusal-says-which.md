---
"nextly": patch
---

Asking for a preview link that cannot be built now says which of five things is
wrong, instead of telling every editor to fill in a slug.

The resolver behind preview links refuses for five distinct reasons: the
document is gone, the collection declares no preview at all, the declaration
yields no address for this document yet, the address it yields is on a different
site, or it does not parse. All five arrived as one message — "this entry has no
preview address yet, so filling in the fields its preview URL is built from —
usually the slug — makes it shareable." For three of them that is wrong and
unactionable. An editor whose slug was already correct was sent to look at the
one field that was not the problem, and a preview URL pointing at another origin
is something no field on the entry can change.

Each refusal now names its own remedy and the person who can apply it — a
missing declaration is a developer's job, an empty slug is the editor's, and a
foreign origin belongs to whoever owns the preview URL or the site URL setting.

**The public preview route is deliberately unchanged and still answers all five
with the same 404.** That is not an oversight: distinguishing them there would
let a stranger holding a forged token tell a deleted entry from an unpublished
one from a collection that has no preview, which is an oracle for what exists in
draft. The reasons are surfaced only on the authenticated path, where the caller
already holds edit access on the document and learns nothing by being told. The
route's answer is now DERIVED from the detailed one in a single place rather than
computed alongside it, so the two cannot drift into disagreeing about when to
refuse.
