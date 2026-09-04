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

A page could reference a reusable component and nothing would draw it. The
reference is one node holding a component id, a variant name and a set of
overrides; what a reader has to render is that component's whole tree, with the
overrides applied and the page's own slot content in place of the component's
defaults. Nothing turned the first into the second.

The blocks engine now resolves them. Every inlined node is identified from the
instance and the node it came from, so one page produces the same ids on every
render and two instances of one component never collide — which is what lets
styles, editor history and React keys go on addressing them. A variant's values
apply first and the instance's own beat them, and an override can clear a value
rather than only replace it, so an author can empty a subtitle the component
fills in.

A component that cannot be inlined — not published yet, containing itself, or
nested past the composition limit — costs its own region rather than the page:
the reference stays where it is, marked with why, and the rest of the page
renders.
