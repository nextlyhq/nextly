---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/plugin-mcp": patch
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
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
---

A Text, a Rich text and a Heading can be turned into one of the other two in one step, from the block's menu, the bar's More menu, the command palette, and the "Turn into" choices of the bar over selected words; the paste note's "Turn into Rich text" now does it. The words stay, and the block keeps its name, styles, block style, shared styles, visibility and conditions. A Text keeps its bold, italic and links as a Rich text; turning into a Heading says "Bold and links are removed"; a Rich text becomes a Text or a Heading only while it is one paragraph or one heading, and otherwise says why. A block style, which belongs to one block type, is kept as the new block's own styles. A binding stays only where the new block can show the field. Inside a component, a block whose words the component offers to its placements isn't turned. One Undo turns it back.

The engine's document operations gain "turn into" (`{ kind: "turnInto", id, node }`), with `planTurnInto` and `turnIntoTargets` to plan one, and a block definition may declare `converters` saying how it turns into another type. All of these are additive and `@experimental`; nothing stored changes shape, and live pages render as before.
