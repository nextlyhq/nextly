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

Choose which interaction state you are styling.

The Style tab now opens with a None / Hover / Focused / Pressed control. Values
you edit go to the chosen state, and the canvas draws the selected block in it,
so what you are editing and what you are looking at are the same thing.

Each state says whether it already holds styles of its own. Reading the values
cannot tell you that: styles inherit, so a state you have never touched shows
the base values and looks set. The marker is in the accessible name as well as
on screen.

Leaving the Style tab returns the canvas to the normal appearance, so a state
switched on cannot be left behind on a tab that no longer shows the control.
