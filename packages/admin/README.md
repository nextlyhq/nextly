# @nextly/admin

Admin dashboard and management interface for Nextly.

## Installation

```bash
npm install @nextly/admin
# or
pnpm add @nextly/admin
```

## Peer Dependencies

This package requires the following peer dependencies:

- `nextly` - Core Nextly package
- `react` - React 18 or 19
- `react-dom` - React DOM 18 or 19
- `next` - Next.js 14+

```bash
npm install nextly react react-dom next
# or
pnpm add nextly react react-dom next
```

## Usage

### App Router Integration

```typescript
// app/admin/[[...params]]/page.tsx
import { RootLayout, AdminRouter } from "@nextly/admin";
import "@nextly/admin/styles.css";

export default function AdminPage() {
  return (
    <RootLayout>
      <AdminRouter />
    </RootLayout>
  );
}
```

### API Route Setup

```typescript
// app/admin/api/[[...params]]/route.ts
import { createDynamicHandlers } from "nextly/runtime";

const handlers = createDynamicHandlers();
export const { GET, POST, PUT, PATCH, DELETE } = handlers;
```

## Exports

| Export                     | Description               |
| -------------------------- | ------------------------- |
| `@nextly/admin`            | Main components and hooks |
| `@nextly/admin/styles.css` | Required CSS styles       |

## Features

- Collection management dashboard
- User and role management
- Media library with drag-and-drop
- Dynamic collection builder
- Field permissions UI
- Dark/light theme support

## Related Packages

- `nextly` - Core Nextly functionality
- `@nextly/client` - Client SDK for browser-based applications
- `@nextly/ui` - Shared UI components

## Documentation

Full documentation coming soon.

## License

MIT
