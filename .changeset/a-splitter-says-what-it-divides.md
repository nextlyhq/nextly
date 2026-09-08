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

A resizable splitter now has to say what it divides, and the type is what
enforces it.

The handle between two panels is focusable, so a keyboard user lands on it
whether or not anyone thought about them. `react-resizable-panels` supplies
everything else about that element — the separator role, the orientation, and
a position between a minimum and a maximum — but it cannot supply the one
thing only the caller knows: what the two panels hold. Every handle in the
admin was unnamed, so landing on one announced a bare number, "74", with
nothing saying what was at 74 or what moving it would do.

The name is now REQUIRED by the component's type rather than recommended in
its documentation. A rule with nothing enforcing it is not a control, and this
one had already been broken at every call site by people who had no reason to
know: the handle looks like a divider, and dividers are not usually things you
name. Either `aria-label` or `aria-labelledby` satisfies it, and the two cannot
be combined — a second name is not a stronger label, it is an ambiguity
resolved by precedence rules the author is not thinking about.

The four splitters in the product are named for what sits on each side of them:
the page builder's panel-and-canvas and canvas-and-inspector divisions, the API
playground's request and response panes, and the translation editor's source
and target.
