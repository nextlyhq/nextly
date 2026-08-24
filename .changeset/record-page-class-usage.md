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

Record which named classes each page references, so the classes UI can answer
"where is this used" as a lookup rather than by walking every stored document.
A hidden `usedClasses` field on the pages collection is derived in the same
write that saves the page, so no window exists where a page is stored and its
record is not. The walk is total over persisted data: a malformed document
contributes what it can read instead of failing an author's save, and it keeps
the readable entries of a partly-malformed class list because under-counting is
the direction that gets a class deleted.

`walkNodes` now skips an entry that is not an object and a slot whose children
are not an array, rather than throwing. It is shared by everything that reads a
document, so one malformed entry previously broke counting, measuring and
rendering alike — each looking like a fault of its own.

It also walks iteratively and skips a node already on the path from the root to
itself, so neither a forest nested deeper than the call stack allows nor a slot
holding one of its own ancestors ends the walk with a `RangeError`. Depth is a
validation rule and this walk runs on documents whether or not validation passed
on them. Tracking the ancestor path rather than every node seen keeps one node
object placed in two slots visited twice, which is what lets an insert still
detect a duplicate ID inside an incoming subtree.

Its third parameter now accepts a `WalkOptions` object — `parent`, `maxNodes`
and `onCycle` — and still accepts a bare parent node, so a caller compiled
against the previous signature keeps working. `maxNodes` ends the traversal
rather than only skipping work in the callback, and the walk holds each list
with a cursor instead of seeding one stack entry per top-level node, so the
budget bounds a very wide root array too. Traversal order and the parent each
callback receives are unchanged.

The node selection both readers use is now one function, `selectNodes`, exported
from the engine and consumed by the style compiler and by the class-usage
record. They previously stopped at the same NUMBER by different walks, and equal
limits reached by different walks select different nodes: a document whose first
root nests deeply spends the whole budget inside it under a depth-first walk and
reaches later top-level siblings under a level-ordered one. A class on such a
sibling was styled and rendered while being absent from the record a safe-delete
check reads.

`insertNode` refuses a subtree containing a cycle. The shared walk is
cycle-tolerant so that readers answer rather than fail, which makes the repeat
invisible in what it visits; the walk now reports a skipped cycle, and the
insertion guard refuses on it. Accepting one produced a cyclic forest at the top
level and a `RangeError` when inserting into a parent.

The page-builder plugin, its pages collection and `rebuildClassUsage` take the
document `limits` pages are rendered under. `PageRenderer` already accepted
them, so a host raising them rendered more of a document than the usage record
counted — a class on a node the page draws was missing from the list a
safe-delete check reads. Left unset, every side uses the engine defaults and
agrees by construction.

The page-save hook leaves a write that says nothing about `usedClasses`
completely alone. On a drafts-enabled collection, publishing sends `status` by
itself and the mutation service folds the promoted draft UNDER the post-hook
payload, so a value derived here from the outgoing live row replaced the record
the draft accumulated from the very content being published.

An incomplete derivation is no longer recorded. `classUsageOf` replaces
`classIdsUsedBy` and returns whether the whole document was read; when a bound
stopped the selection, the write hook removes the field and the rebuild counts
the page as `undetermined` rather than storing a list. The record exists so a
class can be deleted safely, and a delete check reads a missing id as evidence
the class is unused — so a list truncated by a bound would licence exactly the
deletion it is there to prevent. A page with no record blocks deletion until a
rebuild can give it one, which is the same position a page written before the
field existed is already in.
