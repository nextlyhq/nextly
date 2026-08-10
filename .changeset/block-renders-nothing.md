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
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
---

Let a block declare that its props guarantee it draws nothing, so its styles stay off the page.

A block that draws nothing still cost a reader something: the stylesheet carried its rules, and a rule may name a URL, so an empty block could make a request on behalf of markup that never appeared. The renderer could already tell that an unregistered or un-upgradable node would not draw, but only a block knows that `core/image` with no source is the same case.

`BlockDefinition` gains an optional `rendersNothing(props)`. It is consulted before any render, on the stored props alone, and `core/image` and `core/embed` implement it. Asking the block rather than listing block names in the renderer is what keeps that decision generic: the same property belongs to any block whose output depends on a prop being present, including ones written outside this repository.

Every failure mode resolves to "it draws" — a block that does not implement the hook, one that throws, and one that answers with something other than a boolean. Withholding the rules of a block that does draw ships it unstyled, which a reader sees; keeping the rules of one that draws nothing wastes bytes, which nobody sees, and that asymmetry decides the default.
