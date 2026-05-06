# @revnixhq/client

The browser-side type-safe REST client SDK for Nextly.

<p align="center">
  <a href="https://www.npmjs.com/package/@revnixhq/client"><img alt="npm" src="https://img.shields.io/npm/v/@revnixhq/client?style=flat-square&label=npm&color=cb3837" /></a>
  <a href="https://github.com/nextlyhq/nextly/blob/main/LICENSE.md"><img alt="License" src="https://img.shields.io/github/license/nextlyhq/nextly?style=flat-square&color=blue" /></a>
  <a href="https://nextlyhq.com/docs"><img alt="Status" src="https://img.shields.io/badge/status-pre--alpha-red?style=flat-square" /></a>
</p>

> [!WARNING]
> **`@revnixhq/client` is a placeholder package.** The class and methods exist, but every method currently throws `Not implemented`. The implementation lands ahead of 1.0. For now, query the [REST API](https://nextlyhq.com/docs/api-reference/rest-api) directly with `fetch` from your client code.

## Planned shape

When the SDK ships, it will provide:

```ts
import { NextlySDK } from "@revnixhq/client";

const sdk = new NextlySDK({ baseURL: "/api" });

const { docs, totalPages } = await sdk.find({
  collection: "posts",
  where: { status: { equals: "published" } },
  limit: 10,
});
```

Types for `posts.title`, `posts.body`, etc. will be inferred from your `nextly.config.ts` collections.

## Until the SDK ships

Use `fetch` against the REST API. Example (server component or client code):

```ts
const res = await fetch("/api/posts?where[status][equals]=published&limit=10", {
  cache: "no-store",
});
const { docs } = await res.json();
```

For server-side queries from inside the same Next.js process, use the [Direct API](https://nextlyhq.com/docs/api-reference/direct-api) on `@revnixhq/nextly` instead. It bypasses HTTP and is fully typed today.

## Compatibility

- Modern browsers (ES2022+)
- `@revnixhq/nextly` 0.0.x

## Documentation

**[Client SDK roadmap →](https://nextlyhq.com/docs/api-reference/client)**

## Related packages

- [`@revnixhq/nextly`](../nextly) – exposes the REST API this client will talk to
- [`@revnixhq/admin`](../admin) – admin panel
- [`@revnixhq/ui`](../ui) – component library

## License

[MIT](../../LICENSE.md)
