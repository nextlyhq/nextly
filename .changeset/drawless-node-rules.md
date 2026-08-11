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
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
---

Stop publishing the rules of a block that draws nothing.

A block can declare that its props make it draw nothing, and `core/image` with no source and `core/embed` with no `src` both do. The stylesheet did not consult that declaration, so every rule compiled for the markup such a node WOULD have drawn was still published — matching no element, and naming whatever it referenced. An image block waiting for its picture announced the URL of a background it never painted.

The declaration now reaches the style compiler, which holds those rules per node rather than emitting them into the main sheet, exactly as it already does for a condition-gated node. A page compiled since carries an entry for each drawless node, and the reader appends only the ones that draw.

What made this worth doing carefully is the direction it must NOT go. Dropping a node from the style input marks the document repaired, and a repaired document with nothing to recompile from has its whole stylesheet withheld. Blanking every rule on a page because one image is waiting for its picture is a far larger regression than the unused bytes it saves, and an unfilled image is an ordinary authoring state rather than the exceptional one the other prune cases describe. So a stored sheet that predates this keeps its node and ships whole; republishing the page compiles the entries and the drop starts working, with nothing to invalidate by hand.

`declaresNoMarkup` in `@nextlyhq/blocks-engine` is now the single implementation of the question. SEO derivation had its own copy and now shares this one, so the compiler, the renderer and the derived metadata cannot answer differently about the same node. It fails in the opposite direction to `isConditionGated`, and deliberately: an unreadable visibility condition must count as gated or hidden content leaks, while a block that throws or answers with a non-boolean must count as drawing or a node that is on the page loses everything derived about it.

Block-type default rules stay in the main sheet, because they come from the block package rather than from the document and a sibling of the same type that does draw still needs them.
