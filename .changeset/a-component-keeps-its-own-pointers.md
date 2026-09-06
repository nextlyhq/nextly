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

Saving a selection as a reusable component now plans the whole operation, and
converting one replaces the blocks with a linked instance in the same plan.

A component definition is not only a tree: its exposed properties and slot
regions are pointers INTO that tree, and saving a selection re-mints every node
id in it. A pointer carried across unchanged names a node the stored document
does not contain — a definition that loads, renders, and offers the property in
the inspector, where editing it writes an override that resolves to nothing.
Every pointer is now re-aimed through the map the copy produced, and one that
names a node outside the selection is refused with the reason rather than
silently dropped.

The exposure a caller nominates is judged by the same envelope rules that gate
publishing, published as `componentEnvelopeIssues` so the plan and the gate
cannot come to disagree. A converted run is refused for anything its ops would
be refused for — a locked block, an ambiguous id, a container that will not
take a component instance — while the author still has the selection in front
of them.

`PatternTarget` is now `LibraryTarget`: one type for all three library kinds,
since a pattern, a component and a layout are stored the same way.

A convert now refuses everything its own ops would be refused for, including a
malformed node the author never selected and an id duplicated on a descendant of
what it removes — `remove` rejects the whole subtree in that case, because the
inverse it records could not put it back. That rule is published as
`subtreeRemovalRefusal`, alongside the other refusals a planner has to be able
to ask.

A nomination naming a node id the selection holds twice is refused rather than
silently re-aimed at whichever copy came last.
