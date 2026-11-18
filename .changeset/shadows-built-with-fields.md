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

Shadows are built with fields. A shadow variable in Design and a block's shadow in its Style tab use the same shadow control:

- each layer has X offset, Y offset, Blur, Spread, Colour (a colour variable or a colour of its own) and Inside;
- "+ Add layer" adds another layer, and a layer can be moved and removed;
- a preview card shows the shadow in light, and in dark where a colour it uses has a dark value.

"Edit as CSS" shows the stored CSS. Typed CSS is read back into the fields where it can be. Where it can't, it is kept exactly as typed, with "Shown as CSS because it can't be shown as fields", and it is still checked.

A shadow variable's value is now checked like the other kinds. A save refuses a shadow CSS can't draw, such as `0 4px 12pxred`, a negative blur, or a layer with no X and Y offset.

A shadow coloured by a colour variable follows that colour's dark value in dark mode, wherever the dark-mode switch is placed. A new shadow variable starts as one soft layer, `0 4px 12px rgba(0, 0, 0, 0.12)`, instead of a shadow that draws nothing.
