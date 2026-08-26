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
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
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
"create-nextly-app": patch
"nextly": patch
---

Images, galleries and buttons inside rich text render on the page.

An author who placed an image in a rich-text field saw it in the editor and the
published page had no trace of it. Those nodes keep their content in their own
fields rather than in `children`, and the renderer's unknown-node fallback
descends into children — so it found none and drew nothing at all, with nothing
anywhere reporting a loss. Image, gallery, button and button-group now draw.

Dispatch reads the node's TYPE before its `text` field. A button holds its label
in `text`, so asked the other way round it published as bare words in the middle
of an article. One node with the same collision had already been answered with a
guard in front of the branch; ordering answers it for every node instead.

`RichText` accepts an optional `hostPolicy`, the same object a block receives.
Media sources cross the two filters blocks apply: the scheme check refuses a
value that could execute and applies whether or not a policy was passed, while
the site's fetch list is asked only when configured — absent means unasked, so a
site that never configured one keeps its images.

One refused source removes itself rather than what surrounds it. A gallery drops
the image it cannot fetch and keeps the rest; a group drops the button whose
destination was refused and keeps its siblings.

Video is not yet drawn, and a check now says so out loud rather than leaving it
silent: `scripts/rich-text-renderer-covers-the-editor.test.mjs` reads the node
types the editor registers and the types the renderer draws, and fails on any
that is neither drawn nor declared with a reason.
