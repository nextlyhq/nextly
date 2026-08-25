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

Every style control in the inspector now says where its value came from. A small dot beside the
label reports whether you set the value on this block, or it arrived from a named class, from the
block's own defaults, or from the page — named in words on hover and to a screen reader, not only
by colour. A property nothing has set shows no dot at all, so a section of empty controls stays
quiet.

The distinction is the point: a control showing an inherited value looks identical to one you
authored, and typing into it silently takes the value over. Knowing which is which before you
type is what stops an author editing a class through a control that appears to belong to one
block.

Where a value could have been written by either of two controls — a background image can come
from the image field or the gradient field, and the compiled cascade records only the CSS it
wrote — the dot stays absent rather than claiming a value the control may not hold.
