# @nextlyhq/plugin-mcp

**Experimental.** Exposes a Nextly install's schema and content to AI agents
over the [Model Context Protocol](https://modelcontextprotocol.io), read-only.

This release contains the package and its plugin definition only. It serves no
protocol endpoint yet: installing it changes no route, no field and no
permission. The surface lands in small reviewable pieces, and this one exists so
that later pieces are additions to a published package rather than one drop.

## Install

```sh
pnpm add @nextlyhq/plugin-mcp@alpha
```

## Use

```ts
import { mcpPlugin } from "@nextlyhq/plugin-mcp";
import { defineConfig } from "nextly/config";

export default defineConfig({
  plugins: [mcpPlugin()],
});
```

`enabled` defaults to `false` and stays that way while the surface is
experimental. What the endpoint will expose is an install's schema and content
to any client that can reach it, so turning it on is an operator's decision
rather than something a version bump does.

## Status

Read-only by design for its first release. Writes, if they arrive, land as
proposals a person reviews rather than as direct edits.

## Related packages

- [`@nextlyhq/plugin-sdk`](../plugin-sdk) — the SDK this plugin is built on
- [`nextly`](../nextly) — the core whose schema and content this exposes

## Licence

MIT
