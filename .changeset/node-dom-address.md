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
"@nextlyhq/module-specifiers": patch
---

feat(blocks-react): give the editor a per-node DOM address

`PageRenderer` gains `nodeAttribute`, OFF by default. Turned on, each block's
root carries `data-nx-node="<node id>"` — the only per-node hook that reaches the
DOM independently of styling.

The scoped class cannot serve: `classNameFor` returns the block-TYPE class alone
for a node with no compiled styles, so hit-testing on the class cannot address an
unstyled node and would resolve to the wrong instance. Most nodes on a real page
are unstyled.

The attribute is applied ABOVE `withNodeAttributes`' early return rather than
joined to its allowlist loop, because that return fires for any node with no
`cssId` and no `attributes` — nearly every node — so an address on the loop would
have landed on almost nothing while a fixture setting either field passed.

Off by default because a published page should not carry editor concerns, which
is why Gutenberg's `data-block` is editor-only. Opt-in is also reversible;
always-on would be a breaking change to remove.

`NODE_ID_ATTRIBUTE` is published so an editor never hard-codes the spelling.
