---
"nextly": patch
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
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
---

Page builder: the editor's repair notice now also repairs a page whose blocks sit where the placement rule refuses them, such as a Button inside a linked Card or a block in a slot its container does not declare. Each such block moves, with its id and everything inside it, to just after the nearest container that allows it; no block is removed, the steps are shown before anything changes, and the repair is one edit that undo takes back. Locks are repaired first, and a block with nowhere it may go stays where it is and the notice says so. The notice is now headed "Repair this page". The experimental engine API gains `placementRepairRule`, a `cause` on a repair's move step, and `remainingPlacements` on a repair plan.
