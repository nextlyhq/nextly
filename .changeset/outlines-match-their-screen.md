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

The admin's loading outlines now match the screens they stand for, so nothing moves when a screen's data arrives:

- A collection's document screens can start with the rail's panel folded away by declaring `views[slug].foldedPanel: true` (experimental). The admin's first frame reads the declaration, so the outline is drawn folded and the frame no longer slides 256 px when the editor arrives. The Forms builder declares it, and keeps its submissions count's place in the bar while the count loads. The reader's choice to open the panel is now remembered per collection, so a choice made on the Forms builder before this release is asked again once.
- A list's outline draws as many rows as the list drew the last time this person opened it, kept on the device as a number alone and forgotten with the rest of what the admin keeps. Before 0.4 s an outline now holds its place, laid out but not drawn, so a plugin's content under a list is not drawn up into an empty space and pushed back down.
- The users list lays its columns out by fixed widths, shared with its outline, so the columns no longer jump when the rows land, and its Columns control is drawn at once.
- The release tabs hold their counts' place while the counts load, and the releases list waits for them before it decides whether to show its search.
- A list's toolbar keeps its controls side by side on a narrow column, the search giving way first.
- A signed-in screen whose code is still on its way draws its outline, the one the frame drew, instead of a loading state of its own.
