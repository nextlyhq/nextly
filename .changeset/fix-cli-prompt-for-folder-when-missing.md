---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"nextly": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/ui": patch
---

`create-nextly-app` now prompts for a folder name when none is given on the command line. Previously, running `npx create-nextly-app` with no positional argument was silently treated as "install in the current directory" and then aborted with a `Directory not empty` error once the user finished the template / database prompts. The CLI now asks `What should your project be called?` with `my-nextly-app` pre-filled; you can accept the default with Enter, type any folder name, or type `.` (or `./`) to install in the current directory — matching the way the positional argument already worked. When the chosen target directory is non-empty the CLI now offers a three-option recovery prompt (cancel / remove existing files and continue / ignore files and continue) instead of aborting outright; the `remove` option preserves any `.git` directory so existing history is kept.
