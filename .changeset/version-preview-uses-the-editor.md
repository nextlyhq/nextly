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

A past version now reads the way the document reads. Previewing one used to go through a viewer
written only for version history, which had its own idea of how each field type looked and knew
nothing about tabs, rows or collapsible sections — so a version was legible but never quite the
page it came from. It is drawn by the editor's own field components now, read-only, which means
layout survives, every field type presents exactly as it does when editing, and a field type added
in future is supported in history the day it renders in the editor.

The snapshot is rendered against its own form rather than loaded into the live one. Nothing an
editor has typed is disturbed by opening a version, and no historical value can reach a save or an
autosave, because those values never enter the form that either of them reads.
