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

**`saveAsPatternRefusal` is new on `@nextlyhq/blocks-engine`.** The counterpart to `patternRefusal`, published for the same reason and against the opposite mistake: that one stops a palette OFFERING a stored pattern the planner would reject, and this one stops a surface offering to SAVE a selection the planner would reject — a button that accepts a click and then fails.

Before it, the only way to ask was to call `planSaveAsPattern` with a `target` invented for the purpose — a collection name and a field set that a surface deciding whether to _offer_ the save does not have yet. So the question could only be asked by answering a different one.

It is a thin view over the planner's own preflight rather than a second walk: the same `plannedSave` both save planners call, so a question answered here and a save attempted afterwards cannot disagree. The ways a selection can be unsavable are not a short list a toolbar should keep its own copy of — not one contiguous run, a block that may not be a document root, a node whose shape the op layer will not carry, a descendant nested where the rules no longer allow, one DOM id on two of the run's own nodes — and a surface enumerating them drifts silently the first time the planner learns a new way to say no: the button stays enabled and the save fails.

Because it does the work a save does up to building the stored document, it is exact, and it is worth memoising on the selection rather than calling per render.
