---
"@nextlyhq/blocks-engine": patch
---

Keep a slot whose stored name is `__proto__`, and stop refusing to edit a document that cannot be serialized.

Rebuilding a record under keys that came from stored data lost any entry named `__proto__`: plain assignment invokes the legacy prototype setter rather than creating a property, so the slot vanished from `Object.keys` and from the stored JSON, and the record's prototype was silently replaced. `removeNode` and `migrateDocument` both hit this, which means deleting one node — or migrating an unrelated one — could delete stored content elsewhere in the same document. `insertNode` had it in both directions, since reading `slots["__proto__"]` returns `Object.prototype` rather than `undefined`.

Separately, the tree primitives now agree on what to do with a document that `JSON.stringify` refuses. They transform what they can reach and never refuse work because the document they were given was already damaged; whether the result can be saved is decided once, at the write, by the check that already answers it. Previously `duplicateNode` alone refused outright when any part of the forest was cyclic, so a corrupt block anywhere on a page stopped an author copying a healthy one.
