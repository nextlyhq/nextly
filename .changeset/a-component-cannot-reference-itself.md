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

A component can no longer be saved into a shape where the library references
itself.

Components may place other components, so the library is a directed graph. A
loop in it is not a crash — the renderer detects one and draws what it reached —
but it leaves a gap where the loop closes, on every page placing anything on the
loop, and nothing said how it got there. The editor already withheld the tiles
that would close one, but that is a snapshot: an author saving against a library
read that had since gone stale closed a loop anyway.

The write now refuses, naming the chain to break — `Hero → Banner → Hero` —
rather than leaving the author to find which placement did it. The check reads
each referenced component as it currently stands, and refuses rather than
guessing when it cannot read them all. A component the saving author cannot read
is named only as `…`, so a refusal does not hand out identifiers.

What it does NOT close is two authors closing a loop between them at the SAME
moment. The check runs before its own write commits and takes no lock the other
write contends for, and a plugin hook has no transaction to enlist in — so two
saves that each read the other's document before either commits are both
approved. Closing that needs a boundary the two writes share.

A component's VARIANTS and its PLACEMENTS count as references. A variant may
preset an exposed `componentId`, and a placement may override one on the
component it places — so a definition whose stored ids look harmless can still
resolve back to itself. Both the insert panel and the write judge a definition by
what it can reach that way, so the editor does not offer a component whose insert
the save would refuse.

The write goes further and asks the RENDERER. Overrides flow down through
nesting, so a placement can re-point a node two levels below it and the loop
exists in the composed tree while no pair of definitions names the other twice.
A save is therefore judged by composing it with the same function that draws the
page, which is the only answer guaranteed to match what a reader would see.

It judges the lifecycle form the write actually changes. An ordinary editor save
is stored as a working draft and leaves the published row alone, so it is checked
against what a preview would show; publishing checks the live library as well.
Publishing an accumulated draft is checked too, even when the request carries
nothing but the new status — that is the write that brings the draft's content
live.

It is deliberately a refusal rather than a warning: the author who closes a loop
is not the person who sees the gap, so a notice would go to someone who has no
reason to act on it.
