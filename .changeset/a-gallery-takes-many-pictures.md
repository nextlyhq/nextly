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

A Gallery now takes many pictures at once. An empty Gallery on the canvas reads **Add images**, with **Upload** and **Media library**, and files can be dropped on any gallery: each picture is uploaded and added as an Image of its own, in the order chosen, picked or dropped, after the pictures it holds, and one Undo takes the whole add back. Its **Content** tab gains **Pictures › Add images**, and **Layout** with **Columns: 2 / 3 / 4** and **On mobile: 1 / 2**; a new gallery shows three across and one on a phone. **When clicked: Nothing / Enlarge** on the gallery applies to every picture that says nothing itself and has no link, which reads **Same as the gallery (Enlarge)**. A picture in a gallery is titled **Picture 2 · in Gallery**, with **← Back to the gallery**. A media picker a host lends the editor may now be asked for several picks, with `mode: "multi"`.
