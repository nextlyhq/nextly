---
"@nextlyhq/blocks-engine": patch
---

Refuse to fill a declared slot whose name cannot be stored, and derive the
expansion depth from the document's own limit.

A block supplied to the inserter rather than registered never passes
registration, so the slot-name rule enforced there did not reach it: a slot
named for an `Object.prototype` member was filled, the op layer rejected the
resulting node, and the author's click did nothing with nothing reported. The
same predicate now answers on both paths.

The expansion also carried its own depth bound alongside the document model's,
and the lower of two policies silently wins — a declaration nesting nine
containers is legal by the document model and was truncated. The bound is now
derived from `MAX_DEPTH`, less the root the caller creates.
