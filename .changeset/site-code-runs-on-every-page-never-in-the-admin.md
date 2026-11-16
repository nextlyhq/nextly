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

Sites can now add code to every published page. People who may change the site's settings save it through the page builder's site code route, which judges it on the server and refuses API keys. The route checks the code against the site's declared Content Security Policy, and asks for an acknowledgement before saving code the policy would block. Each save writes an audit row of hashes and counts, never the code. `<SiteCode>` from `@nextlyhq/plugin-page-builder/site` renders it from the site's layout. In draft mode it renders nothing. Scripts and styles run only through a fixed loader that refuses the admin, the editor's canvas and any page the site frames, so the code never runs inside the admin even when the layout is shared with it. Experimental until site code can be edited in Settings.
