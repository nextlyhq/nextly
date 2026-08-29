---
"nextly": patch
---

Every language of an entry can now be taken down at once.

Publishing every language has been possible since i18n M7. Withdrawing them had
no counterpart at any layer — no admin hook, no route, no service method — so
there was no way to take a localized document down as a whole. An ordinary
update carrying no locale reaches the DEFAULT language only, leaving every other
translation published.

`unpublishAllLocales` closes it.

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
