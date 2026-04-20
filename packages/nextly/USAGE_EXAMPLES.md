# Nextly Usage Examples

This document provides usage examples for the Nextly initialization API, which follows the PayloadCMS pattern.

## Table of Contents

- [Basic Initialization](#basic-initialization)
- [Next.js Integration](#nextjs-integration)
- [Accessing Services](#accessing-services)
- [Graceful Shutdown](#graceful-shutdown)
- [Advanced Usage](#advanced-usage)

---

## Basic Initialization

### Simple Setup

```typescript
import { getNextly } from "nextly";

// Initialize Nextly with minimal configuration
const nextly = await getNextly({
  storage: myStorageAdapter,
  imageProcessor: myImageProcessor,
});

// Access services
const posts = await nextly.collections.find("posts", {}, context);
console.log("Posts:", posts);
```

### With Custom Adapter

```typescript
import { getNextly, createAdapter } from "nextly";

// Create custom adapter
const adapter = await createAdapter({
  type: "postgresql",
  url: "postgres://localhost:5432/mydb",
});

const nextly = await getNextly({
  adapter,
  storage: myStorageAdapter,
  imageProcessor: myImageProcessor,
});
```

---

## Next.js Integration

### In API Routes

```typescript
// app/api/posts/route.ts
import { getNextly } from "nextly";
import { storageAdapter, imageProcessor } from "@/lib/nextly-config";

export async function GET(request: Request) {
  // getNextly is cached - safe to call in every request
  const nextly = await getNextly({
    storage: storageAdapter,
    imageProcessor,
  });

  const posts = await nextly.collections.find(
    "posts",
    {
      where: { status: "published" },
      orderBy: [{ column: "created_at", direction: "desc" }],
      limit: 10,
    },
    { user: null }
  );

  return Response.json({ posts });
}

export async function POST(request: Request) {
  const nextly = await getNextly({
    storage: storageAdapter,
    imageProcessor,
  });

  const body = await request.json();

  const post = await nextly.collections.create(
    "posts",
    {
      data: body,
    },
    { user: null }
  );

  return Response.json({ post }, { status: 201 });
}
```

### In Server Components

```typescript
// app/posts/page.tsx
import { getNextly } from 'nextly';
import { storageAdapter, imageProcessor } from '@/lib/nextly-config';

export default async function PostsPage() {
  const nextly = await getNextly({
    storage: storageAdapter,
    imageProcessor,
  });

  const posts = await nextly.collections.find('posts', {
    where: { status: 'published' },
  }, { user: null });

  return (
    <div>
      <h1>Posts</h1>
      <ul>
        {posts.map(post => (
          <li key={post.id}>{post.data.title}</li>
        ))}
      </ul>
    </div>
  );
}
```

### Shared Configuration

Create a shared configuration file to avoid repetition:

```typescript
// lib/nextly-config.ts
import { LocalStorageAdapter } from "nextly/storage/local";
import { SharpImageProcessor } from "nextly/image/sharp";

export const storageAdapter = new LocalStorageAdapter({
  uploadDir: "./uploads",
});

export const imageProcessor = new SharpImageProcessor({
  quality: 80,
});

export const nextlyConfig = {
  storage: storageAdapter,
  imageProcessor,
};
```

Then use it:

```typescript
// app/api/posts/route.ts
import { getNextly } from "nextly";
import { nextlyConfig } from "@/lib/nextly-config";

export async function GET() {
  const nextly = await getNextly(nextlyConfig);
  // ... use nextly
}
```

---

## Accessing Services

### Collections

```typescript
const nextly = await getNextly(config);

// Find documents
const posts = await nextly.collections.find(
  "posts",
  {
    where: { status: "published" },
    orderBy: [{ column: "created_at", direction: "desc" }],
    limit: 10,
  },
  context
);

// Find one document
const post = await nextly.collections.findById("posts", postId, context);

// Create document
const newPost = await nextly.collections.create(
  "posts",
  {
    data: { title: "Hello World", content: "Lorem ipsum..." },
  },
  context
);

// Update document
const updatedPost = await nextly.collections.update(
  "posts",
  postId,
  {
    data: { title: "Updated Title" },
  },
  context
);

// Delete document
await nextly.collections.delete("posts", postId, context);
```

### Users

```typescript
const nextly = await getNextly(config);

// Find user by email
const user = await nextly.users.findByEmail("user@example.com", context);

// Find user by ID
const user = await nextly.users.findById(userId, context);

// Create user
const newUser = await nextly.users.create(
  {
    email: "user@example.com",
    password: "secure123",
    name: "John Doe",
  },
  context
);

// Update user
const updatedUser = await nextly.users.update(
  userId,
  {
    name: "Jane Doe",
  },
  context
);

// List users with pagination
const result = await nextly.users.findMany(
  {
    limit: 20,
    offset: 0,
  },
  context
);
```

### Media

```typescript
const nextly = await getNextly(config);

// Upload file
const media = await nextly.media.upload(
  {
    filename: "image.jpg",
    mimeType: "image/jpeg",
    size: 1024,
    buffer: fileBuffer,
  },
  context
);

// Find media by ID
const media = await nextly.media.findById(mediaId, context);

// List media with filters
const mediaList = await nextly.media.findMany(
  {
    where: { mimeType: "image/jpeg" },
    limit: 10,
  },
  context
);

// Delete media
await nextly.media.delete(mediaId, context);
```

### Database Adapter (Advanced)

```typescript
const nextly = await getNextly(config);

// Check database capabilities
const capabilities = nextly.adapter.getCapabilities();
console.log("Database:", capabilities.dialect);
console.log("JSONB support:", capabilities.supportsJsonb);

// Execute raw query (advanced use case)
const results = await nextly.adapter.select("custom_table", {
  where: { and: [{ column: "status", op: "=", value: "active" }] },
  limit: 10,
});

// Run transaction
await nextly.adapter.transaction(async tx => {
  await tx.insert("table1", { name: "Record 1" });
  await tx.insert("table2", { name: "Record 2" });
  // Both inserts succeed or both fail
});
```

---

## Graceful Shutdown

### Basic Shutdown

```typescript
import { shutdownNextly } from "nextly";

// Shutdown when application stops
await shutdownNextly();
```

### Process Signal Handlers

```typescript
import { shutdownNextly } from "nextly";

// Handle graceful shutdown
process.on("SIGTERM", async () => {
  console.log("SIGTERM received, shutting down gracefully...");
  await shutdownNextly();
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("SIGINT received, shutting down gracefully...");
  await shutdownNextly();
  process.exit(0);
});
```

### Using Instance Method

```typescript
const nextly = await getNextly(config);

// Later...
await nextly.shutdown();
```

---

## Advanced Usage

### Environment-Based Configuration

Nextly automatically selects the database adapter based on environment variables:

```bash
# .env
DB_DIALECT=postgresql
DATABASE_URL=postgres://localhost:5432/mydb
```

```typescript
import { getNextly } from "nextly";

// Adapter is created automatically from environment
const nextly = await getNextly({
  storage: myStorageAdapter,
  imageProcessor: myImageProcessor,
});
```

### Custom Logger

```typescript
import { getNextly } from "nextly";

const nextly = await getNextly({
  storage: myStorageAdapter,
  imageProcessor: myImageProcessor,
  logger: {
    info: (msg, ...args) => console.log("[INFO]", msg, ...args),
    error: (msg, ...args) => console.error("[ERROR]", msg, ...args),
    warn: (msg, ...args) => console.warn("[WARN]", msg, ...args),
    debug: (msg, ...args) => console.debug("[DEBUG]", msg, ...args),
  },
});
```

### Testing

```typescript
import { getNextly, shutdownNextly } from "nextly";
import { describe, it, expect, afterEach } from "vitest";

describe("My API Tests", () => {
  // Clean up after each test
  afterEach(async () => {
    await shutdownNextly();
  });

  it("creates a post", async () => {
    const nextly = await getNextly(testConfig);

    const post = await nextly.collections.create(
      "posts",
      {
        data: { title: "Test Post" },
      },
      testContext
    );

    expect(post.data.title).toBe("Test Post");
  });
});
```

### Singleton Pattern Benefits

```typescript
// These all return the SAME instance (cached)
const nextly1 = await getNextly(config);
const nextly2 = await getNextly(config);
const nextly3 = await getNextly(config);

console.log(nextly1 === nextly2); // true
console.log(nextly2 === nextly3); // true

// No performance penalty for calling multiple times
// Database connection is established once
```

---

## Migration from Old API

If you were using the DI container API directly, here's how to migrate:

### Before (Old API)

```typescript
import { registerServices, getService } from "nextly";

// Initialize
await registerServices({
  db,
  tables,
  storage,
  imageProcessor,
});

// Access services
const collectionService = getService("collectionService");
const posts = await collectionService.find("posts", {}, context);
```

### After (New PayloadCMS-style API)

```typescript
import { getNextly } from "nextly";

// Initialize and get instance
const nextly = await getNextly({
  storage,
  imageProcessor,
  // adapter created automatically from DB_DIALECT env var
});

// Access services
const posts = await nextly.collections.find("posts", {}, context);
```

**Benefits:**

- ✅ Simpler API - one function instead of two
- ✅ Instance-based access instead of string keys
- ✅ Better TypeScript autocomplete
- ✅ Familiar pattern (matches PayloadCMS)
- ✅ No need to manually provide `db` and `tables`

---

## Comparison with PayloadCMS

Nextly's API is inspired by PayloadCMS but optimized for our architecture:

### PayloadCMS

```typescript
import { getPayload } from "payload";
import config from "@payload-config";

const payload = await getPayload({ config });
const posts = await payload.find({ collection: "posts" });
```

### Nextly

```typescript
import { getNextly } from "nextly";

const nextly = await getNextly({
  storage,
  imageProcessor,
});
const posts = await nextly.collections.find("posts", {}, context);
```

Both follow the same **cached singleton pattern** for optimal performance! 🚀
