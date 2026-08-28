---
"@nextlyhq/blocks-engine": patch
---

Emit a block type's default styles at zero specificity, so a site's own CSS
can override them.

The page-root prefix is doubled so an author's values beat ordinary host CSS,
and block-type defaults inherited that contract without it ever being argued
for defaults. A default nobody can override is not a default. Each such rule is
now wrapped in `:where()`, which matches the same elements and weighs nothing —
so a default also loses to a named class and to a node's own value by
construction rather than by being emitted first.
