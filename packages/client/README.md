# @nextly/client

Client SDK for browser-based applications using Nextly.

## Status

> **Under Development** - Scaffolded in Plan 1, full implementation pending.

This package is currently a placeholder. The full client SDK implementation will provide a type-safe REST API client for browser-based applications.

## Installation

```bash
npm install @nextly/client
# or
pnpm add @nextly/client
```

## Usage

```typescript
import { NextlySDK } from "@nextly/client";

// Initialize the SDK
const sdk = new NextlySDK({
  baseURL: "/api",
});

// Query collections
const posts = await sdk.find({
  collection: "posts",
  where: { status: "published" },
  limit: 10,
});

// Create entries
const newPost = await sdk.create({
  collection: "posts",
  data: { title: "Hello World", content: "..." },
});
```

## Planned Features

- Type-safe REST API client
- Automatic request/response typing
- Authentication handling
- Request caching and deduplication
- React Query integration (optional)
- Optimistic updates support

## Exports

| Export           | Description               |
| ---------------- | ------------------------- |
| `@nextly/client` | NextlySDK class and types |

## Related Packages

- `nextly` - Core Nextly functionality (server-side)
- `@nextly/admin` - Admin dashboard

## Documentation

Full documentation coming soon.

## License

MIT
