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
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-mcp": patch
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

Embeds recognise YouTube (including Shorts), Vimeo, Spotify and Google Maps "Embed a map" links. A pasted link is kept as typed, and the block is sized from its provider with an ordinary style value. By default a provider's player now loads only when a visitor presses play: the page shows a poster frame with no script, and nothing is requested from the provider until then ("Load: When played / Right away"). YouTube and Vimeo use their privacy-enhanced players by default ("Privacy mode"). The poster can show a picture from the media library, and "Use the video's thumbnail" copies a video's picture into the library once, through a new editor route that fetches only from the provider's picture host.

Output change: a new Embed with a provider link renders a poster frame (an iframe with `srcdoc`) rather than the player. Embeds stored before this keep loading the player with the page, now from the privacy-enhanced player where the provider has one. An Embed with an empty screen reader label now gets a title from its provider ("YouTube video") or "Embedded content", rather than an empty `title`.
