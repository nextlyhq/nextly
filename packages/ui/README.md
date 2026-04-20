# @nextly/ui

Headless UI components for Nextly plugins and extensions.

## Status

> **Under Development** - Scaffolded in Plan 1, full implementation pending.

This package is currently a placeholder with basic components. The full UI library will be extracted from `@nextly/admin` to provide reusable components for plugin development.

## Installation

```bash
npm install @nextly/ui
# or
pnpm add @nextly/ui
```

## Peer Dependencies

This package requires React as a peer dependency:

```bash
npm install react react-dom
# or
pnpm add react react-dom
```

## Usage

```typescript
import { Button, cn } from "@nextly/ui";

function MyComponent() {
  return (
    <Button variant="default" size="lg">
      Click me
    </Button>
  );
}
```

## Current Components

| Component | Description                                  |
| --------- | -------------------------------------------- |
| `Button`  | Versatile button with variants and sizes     |
| `cn`      | Utility for merging Tailwind CSS class names |

## Planned Components

Components will be extracted from `@nextly/admin`:

- Form inputs (Input, Textarea, Select, Checkbox)
- Dialog and Modal
- Dropdown Menu
- Data Table
- Tabs
- Toast notifications
- And more...

## Styling

This package uses Tailwind CSS classes. Ensure your project has Tailwind configured and includes the package in your content paths:

```javascript
// tailwind.config.js
module.exports = {
  content: [
    // ... your paths
    "./node_modules/@nextly/ui/**/*.{js,mjs}",
  ],
};
```

## Related Packages

- `nextly` - Core Nextly functionality
- `@nextly/admin` - Admin dashboard (uses this package)
- `@nextly/client` - Client SDK

## Documentation

Full documentation coming soon.

## License

MIT
