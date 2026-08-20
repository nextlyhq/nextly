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

Rich text can now live in a block and render on a published page. A block prop
holds exactly what the rich-text field holds — Lexical's serialized tree — so an
author's rich text is one kind of thing wherever they typed it.

The type, the format bits and the "is this rich text" test move into
`blocks-engine`, which the CMS and the renderer both already depend on, and the
CMS now reads them from there instead of keeping its own. The two cannot share a
READER: the renderer is forbidden from importing the CMS. They can share a
DEFINITION, and now do, so the two can only disagree about output and never
about what the data means. The copies this replaces had already drifted — the
CMS's test accepted a root with no `children`, which its own serializer could
only render as empty.

A stored link URL is now sanitized before it reaches an `href`, through the same
boundary every other stored URL in the renderer crosses; a destination that
boundary refuses renders as the author's words rather than as a link. Links keep
the `target` and `rel` the editor stored. Lexical's three case formats are
recognised rather than dropped, and horizontal rules, tables, code blocks and
collapsible sections render as themselves instead of as loose text.

Two fixes to how stored text is read. A malformed node — a `null` where a node
belongs — is skipped rather than throwing during the render of a published page.
And plain-text extraction no longer inserts a space between every text leaf,
which turned a part-bold `prefix` into `pre fix` for anything reading it for
search or SEO; separators now fall at block boundaries, and the walk is
iterative so a deeply nested value cannot exhaust the call stack.
