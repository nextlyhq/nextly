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
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
"nextly": patch
"@nextlyhq/plugin-form-builder": patch
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
"@nextlyhq/plugin-mcp": patch
---

`@nextlyhq/plugin-mcp` now serves a Model Context Protocol endpoint. It exposes
nothing through it: no tool, resource or prompt is registered yet, so a client
that connects finds a server with no capabilities. What this release adds is the
address, and the checks that decide who may reach it.

The endpoint is a Nextly route rather than a file you mount yourself, so it
inherits the authentication every other route gets: a signed-in session, or
`Authorization: Bearer` with an API key. A key is judged on the grants stamped
on the key itself rather than on what the person who minted it can reach, so an
agent is bounded by the key you give it. A scaffolded project serves the
endpoint at `/admin/api/mcp`.

It stays off unless you turn it on. While `enabled` is `false`, which is the
default, the plugin contributes no route at all.

A request addressed to a hostname you have not published is refused with `403`.
That is what the transport specification requires a server to do, and what makes
a name an attacker controls useless even when it has been made to resolve to
your server: the protocol library ships both the `Origin` and `Host` checks and
applies neither, so a handler wired straight to a route answers a forged `Host`
with `200`. By default the endpoint answers on the hostname of
`NEXT_PUBLIC_APP_URL`, and on localhost if that is unset; `allowedHosts` names
them yourself, and replaces that default rather than adding to it.

Clients speaking the 2025 revisions are served statelessly, which is every
shipping client today. `GET` and `DELETE` answer `405`: they were the session
operations, and the `2026-07-28` revision removed them.
