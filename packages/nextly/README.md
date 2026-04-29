# nextly

Core CMS functionality for Nextly - a modern, type-safe headless CMS for Next.js applications.

## Installation

```bash
npm install nextly
# or
pnpm add nextly
```

## Quick Start

### 1. Initialize Services

Nextly uses a service layer architecture with dependency injection. Initialize services once during app startup (e.g., in `instrumentation.ts` or a bootstrap file):

```typescript
// instrumentation.ts (Next.js 13+)
import {
  registerServices,
  getDialectTables,
  getMediaStorage,
  getImageProcessor,
} from "nextly";
import { db } from "./lib/db"; // Your Drizzle instance

export async function register() {
  registerServices({
    db,
    tables: getDialectTables(),
    storage: getMediaStorage(),
    imageProcessor: getImageProcessor(),
  });
}
```

### 2. Use Services

Once initialized, access services anywhere in your app:

```typescript
import { getService } from "nextly";
import type { RequestContext } from "nextly";

// In an API route or Server Component
const userService = getService("userService");
const context: RequestContext = {
  user: {
    id: "user-123",
    email: "user@example.com",
    role: "admin",
    permissions: [],
  },
};

const user = await userService.findById("user-123", context);
```

### 3. Use Pre-built API Routes

Re-export Nextly's API route handlers in your Next.js app:

```typescript
// app/api/media/route.ts
export { GET, POST } from "nextly/api/media";

// app/api/media/bulk/route.ts
export { POST, DELETE } from "nextly/api/media-bulk";

// app/api/media/folders/route.ts
export { GET, POST, PATCH, DELETE } from "nextly/api/media-folders";
```

## Service Layer

### Initializing Services

Call `registerServices()` once during application startup. This registers all services as singletons in the DI container.

```typescript
import { registerServices, type NextlyServiceConfig } from "nextly";

const config: NextlyServiceConfig = {
  // Required
  db: drizzleInstance, // Your Drizzle database instance
  tables: getDialectTables(), // Database tables for your dialect
  storage: getMediaStorage(), // Media storage adapter
  imageProcessor: getImageProcessor(), // Image processing utilities

  // Optional
  logger: customLogger, // Custom logger (defaults to console)
  hookRegistry: hooks, // For collection lifecycle hooks
  passwordHasher: {
    // Custom password hashing
    hash: pwd => bcrypt.hash(pwd, 10),
    verify: (pwd, hash) => bcrypt.compare(pwd, hash),
  },
};

registerServices(config);
```

### Accessing Services

Use `getService()` to retrieve registered services:

```typescript
import { getService, isServicesRegistered } from "nextly";

// Check if services are initialized
if (!isServicesRegistered()) {
  throw new Error("Services not initialized");
}

// Get services (type-safe)
const collectionService = getService("collectionService");
const userService = getService("userService");
const mediaService = getService("mediaService");
```

### Available Services

| Service             | Description                                          |
| ------------------- | ---------------------------------------------------- |
| `collectionService` | Collection metadata and entry CRUD operations        |
| `userService`       | User management, authentication, password operations |
| `mediaService`      | Media file uploads, folders, and bulk operations     |

#### CollectionService

```typescript
import { getService, type RequestContext } from "nextly";

const collectionService = getService("collectionService");
const context: RequestContext = {
  user: { id: "user-1", email: "...", role: "admin", permissions: [] },
};

// Create a collection
const collection = await collectionService.createCollection(
  {
    name: "Posts",
    slug: "posts",
    fields: [{ name: "title", type: "text", required: true }],
  },
  context
);

// Create an entry
const entry = await collectionService.createEntry(
  "posts",
  {
    data: { title: "Hello World" },
  },
  context
);

// List entries with pagination
const { data, pagination } = await collectionService.listEntries(
  "posts",
  {
    pagination: { limit: 10, offset: 0 },
  },
  context
);
```

#### UserService

```typescript
import { getService } from "nextly";

const userService = getService("userService");

// Create a user
const user = await userService.create(
  {
    email: "user@example.com",
    password: "securePassword123",
    name: "John Doe",
    role: "user",
  },
  context
);

// Authenticate (verifies credentials only, no session)
const authenticatedUser = await userService.authenticate(
  "user@example.com",
  "securePassword123"
);

// List users with pagination
const { data, pagination } = await userService.listUsers(
  {
    pagination: { limit: 20 },
  },
  context
);
```

#### MediaService

```typescript
import { getService } from "nextly";

const mediaService = getService("mediaService");

// Upload a file
const file = await mediaService.upload(
  {
    filename: "photo.jpg",
    mimeType: "image/jpeg",
    size: 1024000,
    buffer: fileBuffer,
    alt: "A beautiful photo",
  },
  context
);

// Create a folder
const folder = await mediaService.createFolder(
  {
    name: "Images",
    parentId: null, // Root folder
  },
  context
);

// List media with pagination
const { data, pagination } = await mediaService.listMedia(
  {
    pagination: { limit: 20 },
    folderId: folder.id,
  },
  context
);

// Bulk delete
const result = await mediaService.bulkDelete(["media-1", "media-2"], context);
```

## Error Handling

### ServiceError

Services throw `ServiceError` for expected errors. Each error has a code and maps to an HTTP status:

```typescript
import { ServiceError, ServiceErrorCode, isServiceError } from "nextly";

try {
  const user = await userService.findById("nonexistent", context);
} catch (error) {
  if (isServiceError(error)) {
    console.log(error.code); // "NOT_FOUND"
    console.log(error.httpStatus); // 404
    console.log(error.message); // "User not found"
    console.log(error.details); // { userId: "nonexistent" }
    console.log(error.toJSON()); // Serializable for API responses
  }
}

// Create errors with static methods
throw ServiceError.notFound("Document not found", { id: "123" });
throw ServiceError.validation("Invalid email format", { field: "email" });
throw ServiceError.unauthorized("Login required");
throw ServiceError.forbidden("Insufficient permissions");
throw ServiceError.duplicate("Email already exists");
```

### Error Codes

| Code                      | HTTP Status | Description                 |
| ------------------------- | ----------- | --------------------------- |
| `VALIDATION_ERROR`        | 400         | Invalid input data          |
| `UNAUTHORIZED`            | 401         | Authentication required     |
| `INVALID_CREDENTIALS`     | 401         | Wrong email/password        |
| `FORBIDDEN`               | 403         | Insufficient permissions    |
| `NOT_FOUND`               | 404         | Resource not found          |
| `DUPLICATE_KEY`           | 409         | Unique constraint violation |
| `BUSINESS_RULE_VIOLATION` | 422         | Business logic error        |
| `RATE_LIMIT_EXCEEDED`     | 429         | Too many requests           |
| `INTERNAL_ERROR`          | 500         | Unexpected server error     |
| `DATABASE_ERROR`          | 500         | Database operation failed   |

### Error Handler Middleware

Use `withErrorHandler()` to wrap API route handlers with automatic error handling:

```typescript
import { NextResponse } from "next/server";
import { withErrorHandler, getService } from "nextly";
import type { RequestContext } from "nextly";

export async function GET(request: Request): Promise<NextResponse> {
  return withErrorHandler(async () => {
    const userService = getService("userService");
    const context: RequestContext = {
      /* ... */
    };

    // If this throws ServiceError, it's automatically converted to HTTP response
    const users = await userService.listUsers({}, context);

    return users; // Wrapped in { success: true, statusCode: 200, data: users }
  });
}

// Response format on success:
// { success: true, statusCode: 200, data: { ... } }

// Response format on error:
// { success: false, statusCode: 404, error: { code: "NOT_FOUND", message: "..." } }
```

Additional error utilities:

```typescript
import {
  serviceErrorToResponse,
  createSuccessResponse,
  createErrorResponse,
} from "nextly";

// Manual error handling
if (isServiceError(error)) {
  return serviceErrorToResponse(error);
}

// Create responses manually
return createSuccessResponse(data, 201); // 201 Created
return createErrorResponse("CUSTOM_ERROR", "Something went wrong", 400);
```

## Plugins

### Creating Plugins

Use `definePlugin()` to create type-safe plugins:

```typescript
import { definePlugin, type PluginContext } from "nextly";

export const autoSlugPlugin = definePlugin({
  name: "auto-slug",
  version: "1.0.0",

  async init(nextly: PluginContext) {
    // Access services with full TypeScript autocomplete
    const { collections, users, media } = nextly.services;

    // Register hooks
    nextly.hooks.on("collections.beforeCreate", async data => {
      if (!data.data.slug && data.data.title) {
        data.data.slug = generateSlug(data.data.title);

        // Check for duplicates using services
        const existing = await collections.listEntries(
          data.collection,
          {
            where: { slug: data.data.slug },
          },
          data.context
        );

        if (existing.data.length > 0) {
          data.data.slug = `${data.data.slug}-${Date.now()}`;
        }
      }
      return data;
    });
  },
});
```

### PluginContext API

Plugins receive a `PluginContext` with type-safe access to:

```typescript
interface PluginContext {
  // Core services
  services: {
    collections: CollectionService;
    users: UserService;
    media: MediaService;
  };

  // Infrastructure
  infra: {
    db: DrizzleDB;
    logger: Logger;
  };

  // Read-only configuration
  config: Readonly<NextlyServiceConfig>;

  // Hook registration
  hooks: {
    on(hook: string, handler: (data: unknown) => Promise<unknown>): void;
    off(hook: string, handler: Function): void;
  };
}
```

## API Route Handlers

Re-export pre-built handlers in your Next.js app:

```typescript
// app/api/[[...nextly]]/route.ts
import { createDynamicHandlers } from "nextly";

const handlers = createDynamicHandlers();
export const { GET, POST, PUT, PATCH, DELETE } = handlers;
```

## Server Actions

```typescript
import { createCollection, updateCollection } from "nextly/actions";

// Create a new entry
const post = await createCollection("posts", {
  title: "Hello World",
  content: "...",
});
```

## Exports

| Export                     | Description                     |
| -------------------------- | ------------------------------- |
| `nextly`                   | Main API (services, DI, errors) |
| `nextly/actions`           | Server Actions for collections  |
| `nextly/api/health`        | Health check endpoint handler   |
| `nextly/api/media`         | Media API handlers              |
| `nextly/api/media-bulk`    | Bulk media operations           |
| `nextly/api/media-folders` | Media folder management         |

### Key Exports from Main Package

```typescript
// DI Container
import {
  container,
  Container,
  registerServices,
  getService,
  clearServices,
} from "nextly";

// Services
import { CollectionService, UserService, MediaService } from "nextly";

// Errors
import { ServiceError, ServiceErrorCode, isServiceError } from "nextly";

// Error Handler
import {
  withErrorHandler,
  serviceErrorToResponse,
  createSuccessResponse,
} from "nextly";

// Plugins
import { definePlugin, createPluginContext } from "nextly";

// Types
import type {
  NextlyServiceConfig,
  ServiceMap,
  RequestContext,
  PaginatedResult,
  PluginContext,
  PluginDefinition,
} from "nextly";
```

## Features

- Type-safe database operations with Drizzle ORM
- Lightweight DI container (~50 lines, SWC-compatible)
- Exception-based error handling with ServiceError
- Role-based access control (RBAC)
- Dynamic collection management
- Media library with folder support
- Authentication with Auth.js
- Hooks system for extensibility
- Plugin architecture with type-safe context

## Production deploys

Nextly uses a CLI-driven migration workflow for production schema changes. Migrations are committed as `.sql` files; a CI step runs `nextly migrate` against the production database before the new app code is deployed. The deployed app never touches schema.

```bash
# Local: edit nextly.config.ts, then generate the migration
pnpm exec nextly migrate:create --name=add_excerpt

# CI: verify integrity + apply
pnpm exec nextly migrate:check
pnpm exec nextly migrate                  # against $DATABASE_URL

# Then deploy your app
```

See the [Production migrations guide](https://nextlyhq.com/docs/guides/production-migrations) for Vercel + GitHub Actions, Vercel build step, and other-platform setups.

## Related Packages

- `@nextly/admin` - Admin dashboard and management interface
- `@nextly/client` - Client SDK for browser-based applications
- `@nextly/adapter-postgres` - PostgreSQL database adapter
- `@nextly/adapter-mysql` - MySQL database adapter
- `@nextly/adapter-sqlite` - SQLite database adapter

## Documentation

Full documentation coming soon.

## License

MIT
