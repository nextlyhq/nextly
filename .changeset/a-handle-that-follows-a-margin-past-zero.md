---
"@nextlyhq/builder": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/admin": patch
"@nextlyhq/ui": patch
"nextly": patch
---

A spacing handle stopped following the pointer when a drag took a margin past zero.

A margin dragged below zero is drawn on the other side of the block's edge, and
its two sides swap roles when that happens. The handle kept the side it was given
when the drag began, so once the value crossed zero it sat on the edge that no
longer moves and the block stopped responding — the drag had to be released and
started again to carry on.

The handle now takes the side the band is drawn with as it is drawn, so a stroke
that runs a margin from positive to negative keeps moving the block the whole way.
