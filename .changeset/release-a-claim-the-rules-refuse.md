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

Let a departing editor give up a document claim the stored rules have stopped
permitting.

The per-document update gate ran on every write intent, and releasing a claim
routes through the same branch. Those rules read the document, so a holder's own
save could flip them mid-claim by changing an owner or a status the rule reads,
and from then on the editor's own release was refused. The claim stood until its
150-second lease lapsed, showing colleagues a holder who had already left and
pushing them to take over a document nobody was editing.

The intent now names the operation rather than grouping every write together.
Claiming and renewing both assert that this editor is editing this document, so
both ask the stored rules. Releasing asserts the opposite and stops at the
collection's update permission, resting on the claim token that names the one
acquisition being given up and fences the delete itself.
