---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
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
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
---

A read that cannot assemble the evidence its access rule needs is now refused rather than allowed. This covers relationships nested in a group or repeater, and counts references as well as checking them: a `hasMany` expansion drops the entries it could not fetch, so a list that came back shorter is evidence that went missing, not evidence that nothing is there. A relationship configured `maxDepth: 0` is left alone, since an unexpanded reference is what that asks for, and so is one declared with the legacy `relation` type, which is never populated at all. Localized references are checked too, by recording what the document referred to once translations were overlaid and before anything was expanded — which is the only point a localized reference is visible at all, and makes the count of what came back comparable for those fields as well. Upload references are held to the same bar as relationships. A relationship pointing at several collections is left alone: it is stored and served as a reference rather than populated, so demanding a document there would refuse every read of a Single that has one.

Translation loading fails the read rather than reading through it. A companion query that errored was previously swallowed, leaving the main row's value in place — which a rule cannot tell apart from a translation that says so.

A relationship that exists only inside a group or repeater is now expanded on read. The check for whether a Single had any relationships to expand looked at top-level fields only, so a schema that nests all of them was returned with bare ids. Reaching into containers is opt-in, and the write-response path does not opt in: it threads no caller, so the target collection's field rules cannot be evaluated for it and the rows it pulled in could not be redacted. Expansion is best-effort by design — a related table that cannot be read yields the bare id — which is right for a response and wrong for a document about to be judged: a rule written as `data.author?.suspended !== true` reads the missing row as permission. Every stored reference a rule may inspect is checked to have become a row before the rule is asked, and a read whose evidence is incomplete fails instead.

A Single deleted while it is being read no longer materializes defaults nobody authorized. The rule approved the stored row; if that row disappears before the read fetches it again, what would be created is a default document no rule has seen. It is judged before it is written, rather than persisted — with its localized defaults and first version — and refused afterwards.

The depth an access rule sees no longer drops below an ordinary read's. A caller asking for `depth: 0` narrows their response, and the authorization view now expands at least as far as an unqualified read would, and further when the caller asked for more.

Access callbacks can no longer write through a `Map` or `Set` in their argument, including through an object used as a `Map` key. They already received plain objects and arrays as copies; these were passed by reference, so a callback could change the payload it was only asked to judge. Data that refers to itself is copied without recursing forever, and a value reachable by two paths stays one object in the copy.

A `?depth=0` read still gets the references it asked for. The response deliberately leaves relationships unexpanded at that depth, so holding it to "every reference became a document" would refuse exactly what was requested; the authorization view judges those relationships at the full read depth regardless. Uploads are unaffected, since they populate at any depth.

The decision made on the document you actually receive is held to the same completeness bar as the earlier one, so expansion that succeeds before your hooks run and fails after cannot leave a rule deciding on a reference where it expects a document. That check runs on the assembled document, before your `afterRead` hooks shape it — a hook is free to drop or replace a relationship, and nothing tells that apart from an expansion that failed.

A read refused for incomplete evidence reports the canonical internal error rather than the underlying failure's own message, which for a database fault is schema detail. That covers relationship expansion, component population, translation loading and the per-locale overview alike.

A group or repeater whose stored value cannot be read — malformed JSON, or valid JSON of the wrong shape such as a list where the field declares a group — now fails the read rather than being treated as empty, which would have walked past every relationship inside it.

Translation loading and the per-locale overview both fail the read when it is being judged, rather than leaving the fields off. An ordinary read is still served best-effort; a rule cannot tell "no translations" from "the query failed", so a read about to be judged gets the failure instead.

Metadata attached to a `Map` or `Set` under a symbol key survives the copy handed to an access callback. Arrays keep their holes and their own properties when handed to an access callback, under the keys they actually have — a decoration like `"01"` no longer overwrites element `1`. Sparse arrays keep their holes, and a `Map` or `Set` carrying its own properties keeps them, so a rule reading either decides on the structure the payload actually has.

A subclass of `Map` or `Set` reaches an access callback as itself rather than rebuilt as the base collection, which would have discarded its methods and private state.
