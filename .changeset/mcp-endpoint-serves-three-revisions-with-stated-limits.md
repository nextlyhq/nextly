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

MCP clients older than protocol revision `2025-06-18` stop working: they are offered `2025-11-25` at `initialize`, and any later request without the `MCP-Protocol-Version` header is refused.

The MCP endpoint now serves exactly the protocol revisions `2026-07-28`, `2025-11-25` and `2025-06-18`, each proven with the official MCP client. A 2025 client that offers an older revision (`2025-03-26`, `2024-11-05`) is offered `2025-11-25` instead, as the protocol says, and a request naming a revision the endpoint does not serve is refused with the protocol's error listing the ones it does. The MCP SDK moves to 2.4.0.

Its limits are now stated rather than left to the SDK's defaults: a request body of at most 4 MiB, refused with `413` naming the size, and at most 10,000 array elements and object members in one tool call's arguments, refused naming the number. Discovery and tool-list answers say they are private to the caller and are not to be reused. What an agent can do does not change: the same five tools, with the same names and answers.

The plugin also gains an internal helper that later tools use to keep state across calls: an opaque handle bound to the person and the credential they used, with a stated lifetime, refused with a plain reason to anyone else, after it expires, or after it has been used.
