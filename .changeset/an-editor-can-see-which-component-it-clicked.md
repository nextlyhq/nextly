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

An editor can tell which rendered elements belong to a component instance.

A component is inlined at render, so the instance node is replaced by the tree
its definition describes and every element inside one carries a node id the
page's own document does not contain. An editor hit-testing on the node address
alone therefore resolved a click inside a component to an address it could not
select, edit or delete.

`INSTANCE_ATTRIBUTE` names the instance an element's node belongs to — the one
the author actually placed on the page, even where components nest. It is
written only for nodes the definition supplied, which is the half that makes it
useful: an instance's slot content is nested inside the same inlined tree but
belongs to the page, so it stays unmarked and directly selectable. That content
is exactly what a marketer opened the editor to change.

It rides the editor's node address the way its siblings do, so a published page
carries none of it.

A node that arrives already claiming `instanceOf` loses the claim. That field
means "the resolver inlined this from a definition", and only the resolving pass
may say so — but documents arrive from places that never ran it, and unknown
node keys are preserved through storage deliberately. Left standing, an editor
would send a click, an edit or a delete to a component the author never placed,
while the node they were pointing at is one of their own.

The composition-free fast path now walks a document carrying such a claim. That
path was previously a pure optimisation; it is not one any more, because the
document where a false claim survives is precisely the one with no components in
it.

The marker is the renderer's to write, and the renderer takes that back from
the two other parties who could reach it.

A BLOCK builds the element the marker lands on, so it can return a root that
already carries one — hardcoded, or spread from a stored attribute bag. The
marker is now ASSIGNED in both directions rather than merely added, so a root
whose node carries no resolver provenance has the attribute removed rather than
left as the block wrote it. The stored document's route into the same namespace
was already closed; this is the same rule for the route a block controls.

A block is also handed the node object itself, and everything read back after
it runs is whatever it left behind. The editor's address — both the instance
and the node id — is now snapshotted at the boundary before any of a block's
code runs, including `rendersNothing` and the `slots` read, and carried down
the synchronous and awaited paths. The awaited one matters most: "after the
render" is a window there rather than an instant, and the same node object
re-enters the output check on the far side of it.

Placeholders carry the markers too. A placeholder is drawn INSTEAD of the
block, so it never reached the marking step — which left the one element an
author can see and click, when a block inside a component fails, addressing
nothing. Definition node ids are re-minted during composition, so for those the
host instance is the only thing an editor can act on.
