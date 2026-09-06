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

A link inside a component pointed at nothing once the component was composed.

A node can spell an HTML id two ways — the modelled `cssId` and the `attributes`
escape hatch — and it renders at most one of them: `cssId` shadows the bag.
Composition was scoping both spellings independently, so a shadowed value got a
per-instance id minted for it as well. That value is what the reference table is
keyed on, so every `aria-describedby`, `<label for>` and `#fragment` naming it
was rewritten to point at an id nothing renders.

Shadowed ids are usually shadowed for a reason: a definition referring to one
was referring to an element in the HOST page, where it resolved. Composition was
breaking exactly those references, which is strictly worse than leaving them
alone.

Only the id a node actually renders is scoped now, through the same published
rule the pattern copier uses. Two spellings carrying one value still move
together to one replacement, so a document that spelled its id both ways keeps
answering to a single address.
