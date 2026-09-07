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

Saving a descendant of an inserted pattern no longer stores the page-specific id.

An insert records what it renamed on the roots it placed — deliberately, because a descendant did not arrive from the pattern separately and marking every node would make detaching one child read as a second insertion. But the restore read each selected node's own record, so selecting a DESCENDANT of an inserted root and saving that as a pattern found nothing to put back: the suffixed, page-specific id went into the new library entry, where the next insert would suffix it again.

The record is now INHERITED rather than stamped more widely. A node uses its own where it carries one — so a pattern inserted inside a pattern still restores against the one it came from — and otherwise its nearest ancestor's, carried down in the shared node walk rather than a traversal of the planner's own.

The scope is keyed by the node, not by its id: a document reaching a planner is untrusted and may spell one id twice, and an id-keyed scope hands a node under one container the record belonging to a different container of the same name. Where one node OBJECT occurs in two places, nothing can say which occurrence a selection meant, so no record is applied and every id is kept.

Every record the selection CONTAINS is applied, not only the selected roots': a run inserted from one pattern can hold a second pattern inserted into it later, and reading only the roots stored that nested copy's page-specific ids. A record applies to the node that HOLDS the id, not to the forest: a node moved out of the run that renamed it is no longer governed by that record, and putting the id back would rewrite one the author now owns. Where nothing in the selection renders the id the record can only be about a reference — a link saved without its target — and that still travels. Two records naming one id are settled the same way, by which of them governs the holder.

Inheritance stops at any node carrying a pattern record, whether or not that record renamed anything — a collision is the exception, so the ordinary insert writes no rename map at all. And a malformed record on a node nothing selected no longer takes the save down: the walk reaches the whole document now, and provenance is read as the untrusted stored data it is, through the same `isBlockOrigin` the document validator uses rather than a weaker reading of its own.
