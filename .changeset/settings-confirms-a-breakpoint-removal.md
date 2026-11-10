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

Removing a breakpoint in the page builder's Settings now asks first. Saving a set without one checks what is stored under it; where something is, Settings shows what would go (per place, the pages named, locked blocks, drafts and anything it could not read or reach) and removes it only on Remove, saying "This can't be undone." A removal that does not finish in its save is followed until it does, a removal still going when Settings opens holds editing the breakpoints until it ends, and one that had to leave documents (a live page under a pending draft) says so. A breakpoint nothing is styled under is removed at Save as before. The Site tab's settings read reports these removals (`removals`, experimental), and the breakpoint editor's `onSave` may answer `null` to keep the draft open with nothing to report.
