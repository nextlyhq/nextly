---
"@nextlyhq/builder": patch
---

Report a heading's typographic baseline even when its block renders
asynchronously.

The style inspector reads which element a node is drawn as by looking at the
canvas. That read was driven by a dependency list, and the DOM moves for reasons
no prop captures: a block whose `render` returns a promise commits its Suspense
fallback first and its resolved root later, changing neither the canvas element,
nor the selection, nor the document. The read therefore ran only before the
marked element existed, and an async block resolving to a heading reported its
font size as unset for as long as it stayed selected.

The reader observes the canvas subtree now, including the node-id attribute
itself — a node's id moving between elements changes the answer without adding
or removing any.
