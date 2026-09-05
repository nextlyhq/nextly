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

A saved pattern can be planned into a page, and every refusal the edit would
have hit is made before the plan exists rather than thrown while it applies.

`planInsertPattern` is the inverse of saving one, and the second composition
planner. It re-identifies the pattern's roots together, so a pattern placed twice
on one page shares no node id and no DOM id with its other copy, and a reference
crossing from one root to the next follows the copy rather than pointing back at
the library. The `"document"` target replaces the page's root forest — a
full-page pattern IS a page layout, and an empty document can be started from one
— while leaving the page's own settings alone, so starting from a pattern does
not repaint the page.

The refusals are the point. A plan that reports success and then throws when it
is applied defeats the reason planning is separate from doing, so the planner
asks everything the op layer will ask and can be asked early: whether each block
may sit where it is going, through both halves of the shared nesting rule — the
child naming its permitted parents, and the slot naming what it admits; whether
the incoming pattern holds a locked block, which cannot be inserted because the
inverse of an insert is a remove and a remove refuses a locked subtree, so the
insert could never be undone; whether replacing the page would delete a locked
block already on it, which is the same rule reached from the other side and a
different block from the author's point of view, so it says so separately; and
whether the destination id is one the document holds twice, which the op layer
refuses because the incoming node would be placed under both.

A refusal names what it needs. A block that may not sit in a container reports
the parents it does permit, and a slot that will not have it reports what it
admits, so a surface can say where the block CAN go instead of only that it
cannot go here.

`lockedWithin` is published from the engine. A planner has to be able to ask
whether a subtree is locked before it builds an insert around it, and a rule the
op layer keeps to itself is one a planner would have to guess at.

One rule decides where a block may sit, for every planner and every
destination. Saving a run lifts it to a document root and inserting a pattern
puts it at a root or in a slot, and those were two implementations of one
question — which is how two answers about where a block may live come to
disagree. The target now says which half of the nesting rule to ask, rather than
each planner asking in its own way.

A destination that does not exist is told apart from one that exists twice.
Counting "not exactly one" sent a stale target — a container that was deleted
between opening the editor and dropping the pattern — to the sentence about a
malformed document, which is advice no author can act on. None means aim
somewhere that exists; more than one means the document itself is wrong.

The position is checked against the op layer's own rule, asked without applying
anything, so a negative index or a parent named without its slot is refused
where a plan is made rather than thrown where it is applied.

Replacing a document refuses one whose ids are not unique. The replacing target
removes every root, and a remove refuses an id the document holds twice — its
own and any inside the subtree it takes with it — so this was a plan that could
not apply. A positional insert removes nothing and is unaffected, which is why
the check belongs to the one target rather than to the planner.

A stored pattern's nodes are checked against the shape rule the insert applies.
A pattern is persisted, so it can hold a node that type-checks and is still
structurally invalid — a `version` of zero is the cheap example — and the plan
reported success while the insert threw on it. Asked of the op layer's own rule
rather than a copy of it, so the two cannot come to disagree about what a node
is. The machine caps on depth and size stay with the apply, because they depend
on limits the plan was never given.
