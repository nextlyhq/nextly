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

Security: the MCP server SDK moves to 2.3.1, nodemailer to 10.2.1 and undici to 7.30.1.

- `@nextlyhq/plugin-mcp` moves from `@modelcontextprotocol/server` 2.0.0 to 2.3.1. Before 2.3.0, one HTTP request within the default size limit could exhaust the server's memory during validation (GHSA-46jr-4wx8-v453); the MCP endpoint validates every request, so it was reachable. Two other advisories fixed in 2.3.0 (GHSA-jm63-cq47-j5jp, GHSA-rvq5-wwqv-78pq) didn't apply: the endpoint already builds a fresh server for each request, and it doesn't use the SDK's bearer authentication.
- nextly's optional `nodemailer` peer moves from `^9.0.1` to `^10.2.1`. nodemailer before 10.1.4 had address-parser denial-of-service and parsing flaws (GHSA-prgh-xp8r-p3m5, GHSA-v53p-9fqp-m79j, GHSA-8c8m-p3m8-cjg8 and others), and the SMTP provider passes the addresses it sends to through that parser. **Apps using nodemailer for SMTP need nodemailer 10:** run `npm install nodemailer@^10.2.1`. nodemailer 10 needs Node.js 20 or later, which Nextly already requires, and nothing in Nextly's use of it changes.
- undici, which `@vercel/blob` and the jsdom behind HTML sanitizing pull in, moves to 7.30.1, past three denial-of-service and integrity advisories (GHSA-xjj6-f33q-929c, GHSA-4qv8-2p9j-2685, GHSA-f72v-6w45-q472). Neither path was exposed in practice: Vercel Blob's client talks only to Vercel's API, and sanitizing loads nothing over the network.
