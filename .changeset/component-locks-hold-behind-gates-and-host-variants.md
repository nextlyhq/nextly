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

Locks a component holds in Layers are judged the same way in the editor and at save, and reach further:

- The editor now refuses a value for a block a component locks when the placement, or a placement inside the component, is behind a visibility condition, as the save already did. The condition gates are lifted by one shared engine helper (`withConditionGatesLifted`, `componentsWithConditionGatesLifted`, experimental), which both use.
- A component's variant that relays a value through a condition-gated nested placement onto a locked block is now refused at save.
- Locking a block in a component now refuses the save when a variant of another component that places it already changes that block, naming the variant and that component.
- Variant checks are charged to the save's work allowance; a save that spends it is refused as unchecked. `variantLockChanges`, not yet in a published release, now returns `{ kind: "judged", changes }` or `{ kind: "unchecked" }` instead of a list, and takes `work`. `hostVariantLockChanges` is new and experimental.
