---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/builder": patch
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
"nextly": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/ui": patch
---

A selection can be saved as a pattern, and whether it is one run of siblings is
now decided in one place.

`planSaveAsPattern` is the first of the composition planners: it reads a
document and answers with the library row to create and the ops the page needs,
writing nothing. Saving a pattern leaves the page exactly as it was — a pattern
is copied on insert and keeps no link back — so its page ops are empty, and that
is the whole behavioural difference from converting a selection into a linked
component. Splitting the decision from the doing is what lets the caller put the
create and the page edit in one unit of work and roll the create back when the
edit fails, and it makes a dry run and a real run the same function rather than
two that agree until one moves.

The rule about what may be saved — a contiguous run of siblings in one parent
and slot — moves into the engine and is published from it. The builder had a
private half of it, which was right while the editor was its only caller and
stopped being right once planners existed: a planner runs inside a plugin's
server action, where the builder cannot be imported because it peer-depends on
React, and the dependency direction is builder to engine, so the engine could
not have imported a builder-side rule back. One of the two would have had to be
a second implementation of "do these blocks share a list", and the module that
held the first one says why that ends badly — it would eventually disagree with
the toolbar and the keyboard, which act through it. The builder's copy is
deleted and its multi-block reorder now asks the engine.

The refusal reports its CAUSE rather than a sentence. Which remedy to offer
belongs to the verb — moving, saving as a pattern and converting to a component
are three different things to be told to do instead — so the engine says what it
observed and each surface phrases it. An id the document does not hold is
reported separately from blocks that sit in different containers: one is a
caller out of step with the document and the other is an author who selected
across a boundary, and a single refusal would have sent both to whichever
sentence was written first.

`reidForestWithMap` re-identifies a run of roots as ONE copy. A saved selection
is several roots, and re-identifying them one at a time is not the same
operation: each call can only see the subtree it was handed, so a reference that
crosses from one root to the next finds no entry in that pass's map and is left
pointing at the element in the page the pattern was saved from. For
`aria-labelledby` and `aria-describedby` that is a copy that has silently lost
its accessible name — invisible to everyone not using assistive technology, and
by the time it is noticed the pattern is on twenty pages. `reidSubtreeWithMap`
is now this function called with one root, so the singular and the plural cannot
drift into disagreeing about what a copy is.

A stored pattern gets fresh ids rather than the page's. It would render
correctly either way, because insert re-identifies too; storing the page's ids
would still be wrong, because a node id is how everything here addresses a node
— styles, locale overlays, the class-usage record, editor history — and two
stored documents claiming one id leave any index keyed on it unable to say which
node it describes. Page-scoped settings are not copied: a document background
and its custom CSS describe the page, not the run, so a pattern carrying them
would repaint every page it was inserted into.

A copied subtree's fragment links follow it. `cssId` is not referenced only by
markup: a link's `href` may be `#pricing`, and the renderer passes a bare
fragment straight through to the DOM, so a copier that mints a new id for the
target and leaves the link behind stores an anchor resolving to nothing — the
same silent breakage as a dangling `aria-labelledby`, one prop over. Composition
had grown this rule; the copier that saves a pattern was written without it, and
a later insert cannot repair the result because its own map is keyed by the id
the save already renamed. The rule now lives in one module that both copiers
use. It stays narrow — only a whole string of `#` followed by an id THIS copy
minted is rewritten — so `"#1 bestseller"` is content and a fragment addressing
something outside the copied run belongs to the page and keeps working.

Locating a node tolerates a damaged document. A stored slot holding `null`
instead of an array, or a list with a hole in it, threw out of the search and
took down every caller — a multi-block reorder and a saved pattern included —
for a node neither of them had touched. These primitives are documented as
reading documents nothing has validated, so a broken entry is skipped and the
answer is about the nodes that were actually asked for.

Only a field that HOLDS a link target is rewritten, and matching a minted id is
not enough on its own. `core/heading` declares `text` and `href` as separate
props, so a heading legitimately reading `#pricing` beside a sibling carrying
`cssId: "pricing"` was rewritten to `#pricing-<suffix>` — authored content
changed silently, and then carried into every insertion of the pattern. The
field name now decides and the value only decides whether there is anything to
do, with `href` and `url` listed as data the way the id-bearing markup
attributes already are. A block with a differently-named target leaves a link
that no longer jumps, which an author can see and repair; the alternative
changed what a page said without anyone being able to see it.

The scan bounds WORK rather than depth. A rich-text link inside a list item sits
ten values down a prop tree, past the old depth cap of eight, so an ordinary
link in a bulleted list was left pointing at an id that had been re-minted. Any
fixed depth is arbitrary — rich text nests as deeply as an author nests it —
while a visit budget bounds a wide tree as well as a deep one and still
terminates on a value that refers to itself.

A saved run reads each selected node by its own id. Resolving the run's parent a
second time and indexing into its slot is not the same operation on a stored
document nothing validated: two nodes may share an id, and the parent a lookup
answers with is the first one, not necessarily the one the selection was located
under. Measured on a document with two parents sharing an id, selecting the
second parent's children saved the first parent's.
