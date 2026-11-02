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

Keep a cleared card title and an emptied filter, and see a hoisted `var` as a taken name in `nextly generate:widget`.

- **A cleared card title stays cleared.** A reader who clears the Title of a card the site's default titles now keeps the automatic title: the layout stores the clearing as an empty `title` (`""`), which the default's own title no longer comes back over. An empty title reads as automatic, as no title does. Rows stored before have no `title` where a reader cleared one, and keep reading as they did.
- **Removing a filter's last chip keeps the card unfiltered.** Where a widget's Filter has a default, removing its last chip stores an empty filter (`{}`), as the preview's Clear filters does, so the default no longer filters the card again or comes back as a chip.
- **`nextly generate:widget` sees a hoisted `var`.** A `var` inside a top-level `if`, loop, block, `try` or `switch` of `nextly.config.ts` counts as a name already taken, so the command does not add an import that would collide with it. A `var` inside a function, and a block's `let` or `const`, stay in their own scope.
