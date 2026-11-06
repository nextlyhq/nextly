---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
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
---

The page builder's canvas shows a bound prop with the value the person editing could see in the admin: the page's own entry and the Singles its bindings read, drafts included and read with their own access. Before, a bound prop on the canvas showed its own text, whatever the source held. A source they may not read shows the binding's fallback. The published page still reads every binding as a visitor. The site settings and the field shapes a binding is checked against are the public's on both.

`@nextlyhq/blocks-react/next` adds `readBindingSources` (`@experimental`): a page's binding sources read through whichever reader a route passes, the published page's own pipeline. `@nextlyhq/blocks-react` adds `bindingsToWire` and `bindingsFromWire` to carry them to the canvas, and `nextly/runtime`'s editor reader reads a Single (`toEditorFindSingle`), its working draft included where the person may edit it.
