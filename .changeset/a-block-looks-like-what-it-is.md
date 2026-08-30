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

A published page emitted styling hooks that nothing styled, so a correct
document rendered broken: images ran full width past their column, body text had
no gutter, and a call to action drew as bare underlined link text.

The mechanism was already here. A block definition's `baseStyles` compiles to
one rule per block type PRESENT in the document, every default is wrapped in
`:where()` so it weighs nothing against a site's own CSS, and the token set
merges in three tiers. Six blocks used it; two more do now.

`core/image` takes `max-width: 100%` with `height: auto`. The element carries
width and height attributes from the media record, which reserve its box and
prevent layout shift — and are also a SIZE, so an asset wider than its column
overflowed. Constraining the width alone would leave the attribute height
standing and draw the image squashed, so the pair moves together or not at all.

`core/button` takes one look rather than variants, because `type` there is the
HTML attribute rather than a visual kind. Its colours are tokens and its
geometry is literal: a literal colour is wrong in whichever mode it was not
chosen for, while no radius token is guaranteed to exist.

A contained container is finally constrained. The rule behind that class could
not be a block default at all — containment is a PROP, so every container of a
type wears the same block-type class whether it opted in or not, and a default
keyed by type would constrain the ones that declined. It is emitted by the site
stylesheet instead, reading the site's own `content.width` token through the
same prefix resolution that declared it, and it states no width of its own: a
site whose tokens omit one gets no containment rather than a width from a place
it cannot see.
