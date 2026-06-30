# @nextlyhq/plugin-sdk

The author-facing SDK for building [Nextly](https://nextlyhq.com) plugins.

> **⚠️ Alpha (`0.x`) — pin your versions.**
>
> The plugin API surface listed in [`STABILITY.md`](./STABILITY.md) is now **stable
> (`@public`) and semver-protected** (D40): once Nextly reaches `1.0`, breaking it
> requires a major version bump. Everything still marked `@experimental` carries **no**
> compatibility guarantee and may change in any release. While we are pre-`1.0`, **pin
> your `nextly` / `@nextlyhq/plugin-sdk` versions** and read the release notes before
> upgrading.

## What this package is

`@nextlyhq/plugin-sdk` re-exports **exactly** the public, semver-protected plugin
surface — nothing internal. **This package _is_ the stability boundary** (D40/D43):
if it's not exported here (or from a subpath below), it is not part of the public
plugin API and may change at any time.

You can build a plugin against `nextly` directly, but importing from
`@nextlyhq/plugin-sdk` guarantees you only touch the supported surface.

## Install

```bash
npm install @nextlyhq/plugin-sdk
# nextly is a peer dependency; @nextlyhq/admin + react are optional peers
# (only needed for the /client and /admin entries).
```

Add the `nextly-plugin` keyword to your plugin's `package.json` so it's
discoverable, and declare a `nextly` core-compatibility range (see below).

## Entry points

| Import                         | Use it for                                                                                                         | Needs React?        |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------ | ------------------- |
| `@nextlyhq/plugin-sdk`         | `definePlugin`, the `contributes`/`ctx`/hook/event/filter types, `PermissionSlug`/`EventName`, `secret()`          | No (Node-safe)      |
| `@nextlyhq/plugin-sdk/testing` | `createTestNextly` — boot a real Nextly on in-memory SQLite for integration tests                                  | No                  |
| `@nextlyhq/plugin-sdk/client`  | `useCan` / `<Can>` — client-side permission gating in admin components                                             | Yes (optional peer) |
| `@nextlyhq/plugin-sdk/admin`   | `registerComponent(s)` / `registerKnownPlugin` — register the React components your `contributes.admin` references | Yes (optional peer) |

The default `.` entry is React-free, so a plugin with no admin UI never pulls
React into a Node context.

## Quick start

```ts
import { definePlugin } from "@nextlyhq/plugin-sdk";

export const myPlugin = (opts: MyPluginOptions = {}) =>
  definePlugin({
    name: "@acme/nextly-plugin-hello",
    version: "0.1.0",
    nextly: "^0.0.2-alpha", // core-compatibility range, boot-checked (D6)
    contributes: {
      collections: [Greetings],
      permissions: [
        { action: "send", resource: "greeting", label: "Send Greeting" },
      ],
    },
    init(ctx) {
      // react to events (observe-only, post-commit); resolve your own slugs via ctx.self (D54)
      ctx.events.on(
        `collection.${ctx.self.collections.greetings}.created`,
        () => {
          ctx.logger.info("greeting created");
        }
      );
    },
    destroy(ctx) {
      // teardown on shutdown / HMR / test teardown
    },
  });
```

Register it in a host app:

```ts
// nextly.config.ts
import { defineConfig } from "nextly";
import { myPlugin } from "@acme/nextly-plugin-hello";

export default defineConfig({
  plugins: [myPlugin()],
});
```

## The plugin model (one-minute tour)

- **`definePlugin({...})`** returns a `PluginDefinition`: declarative **`contributes`**
  (collections, singles, components, `extend`, permissions, events, routes, admin UI)
  plus imperative **`setup` → `init` → `destroy`** lifecycle functions. All plugins'
  `setup`s run before any `init`; load order is a topological sort over `dependsOn`.
- **`ctx` (in `init`/`destroy`)** gives you: `services` (managed, secure-by-default
  data access — pass `{ as: "system" }` to elevate), `db` (raw Drizzle escape hatch),
  `hooks` (in-transaction, modify/abort), `events` (post-commit, observe-only),
  `filters`/`actions` (typed seams), `self` (your entities' resolved slugs after any
  host `.rename()`), `logger`, `config`, and `nextlyVersion`.
- **Hooks vs events:** need to modify or abort an operation → use a **hook**; need to
  react/notify after it commits → use an **event** (best-effort, may be dropped).
- **`ctx.self`** is how you reference your own collections/singles by their _resolved_
  slug, so your plugin keeps working when an integrator renames an entity via
  `plugin.rename({...})`. Never hardcode your own slugs in `init`.

## Stability & versioning policy

The authoritative ledger of what is `@public` (stable) vs `@experimental` lives in
[`STABILITY.md`](./STABILITY.md). In short:

- **Stable (`@public`)** — `definePlugin`/`contributes`/lifecycle, `ctx.services`
  (incl. `{ as: "system" }`), `contributes.routes`, `contributes.admin`
  (menu/pages/views), `ctx.events` + the event-name constants, the collection
  `HookContext`, and `@nextlyhq/plugin-sdk/testing`. Breaking a `@public` export
  requires a Nextly **major** (D40).
- **Still `@experimental`** — the raw `ctx.db` escape hatch, `ctx.hooks` plugin
  registration, filters/actions (D63), `secret()`, `useCan`/`<Can>`, and admin
  dashboard widgets (D22). No compatibility guarantee yet — each graduates once a
  first-party plugin exercises it (D55).
- **Deprecations** warn, keep at least a one-major support window, and ship with a
  migration guide (D41). Promotion (`@experimental` → `@public`) is **not** a breaking
  change.
- **Pre-`1.0` caveat** — during the `0.x` alpha, pin your versions; the major-bump
  guarantee formally applies from `1.0`.
- **Declare a `nextly` range** in your `definePlugin` (e.g. `"^1 || ^2"`); it's checked
  at boot and may span majors. Use `ctx.nextlyVersion` for runtime feature detection.

## Building from source (contributors)

`@nextlyhq/plugin-sdk` declares `nextly` and `@nextlyhq/admin` as **peer
dependencies** and marks them `external` at build time — its generated `.d.ts`
files resolve those types against the **built `dist/`** of `nextly` /
`@nextlyhq/admin`. So build the core packages first:

```bash
# from the monorepo root — builds nextly + admin before the SDK
pnpm turbo build --filter=@nextlyhq/plugin-sdk...
# or just build everything
pnpm turbo build
```

Running `pnpm build` **inside** `packages/plugin-sdk` in isolation against a stale
or missing core `dist/` produces confusing `TS2305: Module 'nextly' has no exported
member …` errors — those are the stale-`dist` symptom, not a real API mismatch.
The Turborepo pipeline (`"build": { "dependsOn": ["^build"] }`) orders this
correctly; prefer it over building the package alone.

## Author guide

See the full plugin author guide, API reference, and error-code reference in the
[Nextly docs](https://nextlyhq.com/docs/plugins). Scaffold a new plugin with:

```bash
npm create nextly-app -- --template plugin
```

which generates the package anatomy plus an embedded `dev/` playground (a minimal
Nextly app on SQLite with hot-reload) for iterating on your plugin locally.

## License

MIT
