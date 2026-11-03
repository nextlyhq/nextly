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
"create-nextly-app": patch
"nextly": patch
---

A blocks field inside a field group was saved without the composition checks
the same field gets on the page itself. The field group's write had no access
to the component library, so a page could place a component past the depth
limit through a field group and have it stored. A field group's blocks field is
now judged with the write it belongs to, on that write's connection, for a
collection entry and a single alike, repeatable field groups included.

Locks in such a field are measured against the blocks a slot starts with
alone. A field group's value has no stored copy of its own to compare with,
and reading one by the page's id and the field's name would read the page's
own field of the same name. So a stored
field-group value whose `"contentOnly"` child kept an older value (an earlier
default, say) is refused on its next save. Put that child back as the block
now starts, and the save goes through.
