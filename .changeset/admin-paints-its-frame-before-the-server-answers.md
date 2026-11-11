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

The admin paints its frame (the top bar, the rail and the logo) as soon as its code runs, before any request answers, and only the content area waits. A screen's still outline appears from 0.4 s in the place its parts will take (the dashboard's cards, a list's table, an editor's fields and side panel, and the other main screens), a thin line moves under the bar from 0.5 s, and from 5 s one line says the server is starting; none of them appears when the data arrives sooner, and under reduced motion nothing moves. The outline gives way to the screen without moving the frame, an editor's bar keeps its buttons in place while the document loads, and the rail holds neutral shapes until its entries are known. A browser that has never signed in here opens on the real sign-in form at once: it takes typing while the server starts, says it is connecting, and sends the sign-in once, when the server answers. Every screen still waits for the server to confirm the session before it draws any data. The outlines are still, never pulsing: `Skeleton` takes a `still` prop for an outline that does not move.
