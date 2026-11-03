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

The page builder's Style tab shows an inherited value where it applies. A control with nothing set at the edited breakpoint and state shows the value that reaches it, greyed, in place of a generic hint or "Not set": a heading's weight reads "Bold 700" from its H2 defaults, and a colour set on an enclosing block reaches the blocks inside it ("From Hero", named as in Layers). The source is named in brief at the end of the label's row ("From Tablet", "From .card", "From H2 defaults"), with the full sentence on hover. A colour's swatch is painted with the inherited colour behind a dashed border, and an alignment group rings the inherited value's icon without choosing it.

The inspector's words are tidier too. The base tier is called Desktop everywhere, as the device switcher calls it; colour is spelled one way; a union's form is chosen with a toggle on its own row ("All | Corners", "Number | Auto") rather than a menu labelled "… form"; Border and Position no longer repeat their name as a heading; and the Font control is as tall as the lists beside it.

A block's element type is labelled "Element type" and drawn as a menu on every block. A `select` prop can ask for that with `display: "menu"`, which keeps it a menu however few its options are.
