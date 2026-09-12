# @nextlyhq/plugin-mcp

**Experimental.** This is the package that exposes a Nextly install to AI agents
over the [Model Context Protocol](https://modelcontextprotocol.io), read-only.

This release adds the transport: an endpoint that speaks the protocol and
exposes **nothing** through it. No tool, resource or prompt is registered yet,
so a client that connects finds a server with no capabilities. The surface lands
in small reviewable pieces, and this is the one an operator can point a client
at.

## Install

```sh
pnpm add @nextlyhq/plugin-mcp@alpha
```

## Use

```ts
import { mcpPlugin } from "@nextlyhq/plugin-mcp";
import { defineConfig } from "nextly/config";

export default defineConfig({
  plugins: [mcpPlugin({ enabled: true })],
});
```

`enabled` defaults to `false` and stays that way while the surface is
experimental. While it is off the plugin contributes no route at all. What the
endpoint will expose is an install's schema and content to any client that can
reach it, so turning it on is an operator's decision rather than something a
version bump does.

## Where it answers

The endpoint is a Nextly route, so it lives under wherever the app mounts its
Nextly handler. A scaffolded project serves that from `/admin/api`, which makes
the endpoint:

```
https://<your-host>/admin/api/mcp
```

Pass `path` to move it within that mount.

## Authentication

The endpoint is authenticated like every other Nextly route: a signed-in
session, or an API key.

```sh
curl https://cms.example.com/admin/api/mcp \
  -H 'Authorization: Bearer nx_live_...' \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'
```

A key is judged on the grants stamped on the key itself, not on what the person
who minted it can reach, so an agent is bounded by the key you give it.

## Which hostnames it answers on

A request addressed to a name you have not published is refused with `403`. That
is what makes a name an attacker controls useless even when it has been made to
resolve to your server, which is the attack the protocol's transport
specification requires a server to defend against.

By default the endpoint answers on the hostname of `NEXT_PUBLIC_APP_URL`, and on
localhost if that is unset. Name them yourself when the install answers on more
than one:

```ts
import { mcpPlugin } from "@nextlyhq/plugin-mcp";
import { defineConfig } from "nextly/config";

export default defineConfig({
  plugins: [
    mcpPlugin({
      enabled: true,
      allowedHosts: ["cms.example.com", "cms.staging.example.com"],
    }),
  ],
});
```

Any form of an address works and is reduced to its hostname, so
`https://cms.example.com`, `cms.example.com` and `cms.example.com:3000` are one
entry. IPv6 needs its brackets: `[::1]`. Setting `allowedHosts` replaces the
default rather than adding to it, so localhost is not silently kept.

## Protocol revisions

Clients speaking the 2025 revisions (`2025-03-26` through `2025-11-25`) are
served statelessly, which is every shipping client today. `GET` and `DELETE` on
the endpoint answer `405`: they were the session operations, and the `2026-07-28`
revision removed them.

## Status

Read-only by design for its first release. Writes, if they arrive, land as
proposals a person reviews rather than as direct edits.

## Related packages

- [`@nextlyhq/plugin-sdk`](../plugin-sdk) — the SDK this plugin is built on
- [`nextly`](../nextly) — the core whose schema and content this exposes

## Licence

MIT
