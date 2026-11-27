# @nextlyhq/plugin-mcp

**Experimental.** This is the package that exposes a Nextly install to AI agents
over the [Model Context Protocol](https://modelcontextprotocol.io).

It is off by default. A client that connects finds a server advertising `tools`
and nothing else: no resource and no prompt. Its five tools read, and one of
them also writes, and only to submit for review:

- `get_initial_context`: what the connecting credential may read, and how this
  CMS expects to be asked.
- `get_workflow`: the review workflow of a collection or Single, its stages and
  steps.
- `get_review_state`: where a document stands in review, language by language.
- `list_waiting_for_review`: what waits for the caller.
- `submit_for_review`: submit parts of a document for review, with a comment.

No tool approves, requests changes, publishes, publishes without review,
assigns or changes a workflow. A person reviews what an agent submits.

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
experimental. While it is off the plugin contributes no route at all. Turned
on, it answers any client that can reach it with a valid credential, so turning
it on is an operator's decision rather than something a version bump does.

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
export NEXTLY_API_KEY=...   # never paste the key into the command itself

curl https://cms.example.com/admin/api/mcp \
  -H "Authorization: Bearer $NEXTLY_API_KEY" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'
```

A key is judged on the grants stamped on the key itself, not on what the person
who minted it can reach, so an agent is bounded by the key you give it.

Authentication runs before the address check below, so a request with no
credential is answered `401` whatever address it used. That is a refusal either
way, and it is the reason a client that is simply missing its key sees `401`
rather than a protocol error.

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

The endpoint serves three revisions of the protocol at the one address:
`2026-07-28`, `2025-11-25` and `2025-06-18`.

- A `2026-07-28` client finds the endpoint through `server/discover`, which
  answers with that revision, the server's capabilities and its name.
- A 2025 client opens with `initialize`. One that offers an older revision
  (`2025-03-26`, `2024-11-05`) is offered `2025-11-25` instead, as the protocol
  says.
- A request that names a revision the endpoint does not serve is refused with
  the protocol's unsupported-version error, which lists the ones it does.

Every revision is served statelessly: the endpoint keeps no session between
requests. `GET` and `DELETE` answer `405`: they were the session operations, and
the `2026-07-28` revision removed them.

Discovery and tool-list answers say they are private to the caller: each caller
is shown what their own credential may use, so no answer is shared or reused.

## Limits

| Limit                                                                                           | Value                   | Over it                                                                    |
| ----------------------------------------------------------------------------------------------- | ----------------------- | -------------------------------------------------------------------------- |
| Request body                                                                                    | 4 MiB (4,194,304 bytes) | `413`, with a message naming the size                                      |
| Array elements and object members in one tool call's arguments, counted together at every depth | 10,000                  | refused before the arguments are checked, with a message naming the number |

## Status

Experimental. One tool writes, `submit_for_review`, and it only submits for
review. See the [MCP plugin docs](https://nextlyhq.com/docs/plugins/mcp) for each
tool's input and answer.

## Related packages

- [`@nextlyhq/plugin-sdk`](../plugin-sdk) — the SDK this plugin is built on
- [`nextly`](../nextly) — the core whose schema and content this exposes

## Licence

MIT
