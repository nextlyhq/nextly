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
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-mcp": patch
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

The inspector names three more choices the way an author thinks of them. A
button's "type" is now "Acts as", and it is offered only while the button has
no link, to a URL a page can follow or to an entry, since a link is then what
the button does. A component can still expose it, for pages that clear the
link. A container's tag is now
"HTML tag", each option named in words ("Generic box", "Main content") with
the tag itself shown muted beside it, and the row is hidden where a block has
only one tag to offer, unless what is stored is another one. A component
field exposing a choice now offers it in the block's words too, read through
`optionLabel`, which `@nextlyhq/blocks-engine` now exports. "Visible on" draws its three devices as separate
toggles with a dot on the device being edited.
