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

Warns a block author, in development, when their block does not render a single
element. The block contract states that a block renders one element and never
wraps it, because the generated class has to go somewhere — so a block returning
a fragment, a list or a primitive already has styles that never apply, and until
now nothing said so.

The only existing signal arrived through the placeholder that replaces such a
block when a document sets an `id` or an attribute on it. That blames the wrong
person at the wrong moment: a page author sets an anchor, watches the block
vanish, and has done nothing wrong, while the block author never hears about it.
The warning fires on the first render instead, whether or not anyone asked for
anything.

Read from what the boundary actually received rather than predicted from the
definition, so the warning and the placeholder cannot come to disagree about the
same output. A block that draws nothing on purpose is exempt, asked through the
same rule the placeholder already uses.
