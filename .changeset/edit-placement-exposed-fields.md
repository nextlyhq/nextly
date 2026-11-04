---
"@nextlyhq/blocks-react": patch
"@nextlyhq/builder": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
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
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
---

A placed component's exposed fields can be edited on the page and in the panel. Double-click a component's exposed text on the canvas to type into it: the edit is stored on that placement only. Text the component does not expose selects the placement and says which component (and variant) it belongs to. In the panel, each field shows whether it is inherited, set here, from a variant or cleared, with a distinct icon for each; emptying a field clears it, and "Reset" returns it to the inherited value. A placement locked in Layers shows its fields read-only, and inside a `contentOnly` area the fields that are not content are read-only with the reason. A link the page could not draw is refused in the field with a message naming it.

Saving a page, Single, component or pattern now refuses a placement value that does not fit its field ("Headline needs text") and an id the component does not expose, when the write sets it; a value the stored document already held is kept. The engine adds `placementValueIssues`, `exposedValueFits` and `neededFor`, and `resolveComponentInstances` takes `exposures: true` to record, for an editor, which exposure feeds each prop of a composed node (`exposedProps`); a render never carries it.
