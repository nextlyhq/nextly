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

Clicking inside a component selects the instance the author placed.

A component is inlined at render: the instance node is replaced by the tree its
definition describes, and every element of that tree carries an id re-minted
during composition — one the page's stored document does not contain. The canvas
resolved a click to that id and handed it to selection, which could not act on
it; the drag path happened to bail instead, because its lookup could not find
the node either.

The hit-test now asks the ELEMENT whether it is definition-owned, and answers
with the host instance when it is.

Asking the element rather than its ancestors is the whole design. An instance's
SLOT CONTENT belongs to the page and is deliberately unmarked, but it renders
nested inside the definition's marked box — so walking up finds that box and
returns the component for a node the author can and should select directly,
which is exactly the content someone opened the editor to change. The marker is
per-node rather than a wrapper element so this can be decided without walking.

The inverse reader answers the same addresses. An instance id names a node that
renders no element of its own, so chrome measuring the selection is pointed at
the first element the definition contributed — the outermost one, in document
order.
