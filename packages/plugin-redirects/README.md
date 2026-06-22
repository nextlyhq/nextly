# @nextlyhq/plugin-redirects

> ⚠️ **Alpha (`0.x`).** Part of the Nextly plugin platform. The plugin API this
> builds on is now stable + semver-protected (see the SDK
> [`STABILITY.md`](../plugin-sdk/STABILITY.md)); this package itself is still alpha,
> so pin a version.

Admin-managed URL redirects for [Nextly](https://nextlyhq.com), modeled on
Payload's `@payloadcms/plugin-redirects`. It:

- adds a **`redirects` collection** (`fromPath` → `toPath`, with a `301`/`302`
  `type`) you manage in the admin,
- declares a **`manage-redirects`** permission,
- exposes a **lookup route**, and
- ships a **Next.js middleware helper** that applies the redirects at request
  time.

Because plugin routes are namespaced, the actual interception lives in your
app's `middleware.ts` (same model as Payload) — the plugin owns the data + the
helper.

## Install

```bash
npm install @nextlyhq/plugin-redirects
```

## 1. Register the plugin

```ts
// nextly.config.ts
import { defineConfig } from "nextly/config";
import { redirects } from "@nextlyhq/plugin-redirects";

export default defineConfig({
  plugins: [redirects().plugin],
});
```

Run `nextly migrate` to create the `redirects` collection, then manage redirects
in the admin (each redirect is a `fromPath`, a `toPath`, and a `301`/`302` type).

## 2. Wire the middleware

```ts
// middleware.ts
import { createRedirectsMiddleware } from "@nextlyhq/plugin-redirects/middleware";

export const middleware = createRedirectsMiddleware();

// Skip API/static assets so only page requests are checked.
export const config = {
  matcher: ["/((?!api|_next|.*\\..*).*)"],
};
```

On each request the middleware looks up the incoming path against the plugin's
lookup route and issues a `301`/`302` when there's a match, otherwise passes
through. Lookups are cached (Next `revalidate`, default 60s) and best-effort — a
lookup failure never breaks the request.

### Options

`redirects(options?)`:

| Option | Type     | Description                                                |
| ------ | -------- | ---------------------------------------------------------- |
| `slug` | `string` | Slug for the redirects collection (default `"redirects"`). |

`createRedirectsMiddleware(options?)`:

| Option       | Type     | Description                                                          |
| ------------ | -------- | -------------------------------------------------------------------- |
| `baseUrl`    | `string` | App origin serving the lookup route. Defaults to the request origin. |
| `revalidate` | `number` | Seconds to cache the lookup (default `60`).                          |

v1 matches on the **exact** `fromPath` (no wildcards/regex); `toPath` may be a
path or an absolute URL.

## License

MIT
