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
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-mcp": patch
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

The blocks engine can now answer, before an edit, the lock questions a save
answers after it. `lockBreaksIn` lists every lock break in a document, naming
the block, the slot, the lock and what changed. `lockRefusal` names the break
an edit would add that the document did not already have. A layout stored
before locks were enforced still opens and can be edited, while a new break is
refused, including any further change to the blocks of a slot already broken.

`planRepair` plans the repair of a document that breaks a lock, as steps a
preview can show and the document confirming them would store. A block a
locked slot may not hold moves to just after the outermost block whose lock
applies, missing starting blocks are added, and a block's design inside a
`contentOnly` slot is put back as it started. No authored block is lost, and
each keeps its id. The planner runs as a list of rules, so a later rule extends
the repair rather than replacing it. A break the lock rule cannot repair, such
as a block its nesting rule allows nowhere else, is left as it is and named in
the plan's `remaining`. All three are `@experimental` until the editor that
uses them ships.

A lock fault from `compositionFaults` now carries `lock`: the block whose slot
is locked, the slot, the lock and what changed. An editor can then word a break
a placement reaches inside a component, and tell a break an edit adds from one
the page already had. Other faults are unchanged.
