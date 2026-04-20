# @nextlyhq/plugin-form-builder

Visual form builder plugin for Nextly. Create and manage forms with a drag-and-drop interface, collect submissions, and filter them by form.

## Features

- **Drag-and-drop form builder** - Visual interface for creating forms
- **Multiple field types** - Text, Email, Number, Textarea, Select, Radio, Checkbox, Date, Country, State
- **Form submissions management** - View and manage all form submissions
- **Submissions filtering** - Filter submissions by form
- **Form status** - Draft, Published, Closed states
- **Customizable** - Override collections, fields, and access control

## Installation

```bash
npm install @nextlyhq/plugin-form-builder
# or
pnpm add @nextlyhq/plugin-form-builder
# or
yarn add @nextlyhq/plugin-form-builder
```

## Setup

### 1. Add to Nextly Config

```typescript
// nextly.config.ts
import { defineConfig } from "@nextlyhq/nextly";
import { formBuilderPlugin } from "@nextlyhq/plugin-form-builder";

export default defineConfig({
  // Just add the plugin - collections are included automatically!
  plugins: [formBuilderPlugin],

  // Your own collections
  collections: [Posts, Users, Media],
});
```

That's it! The plugin automatically adds the `forms` and `form-submissions` collections.

### 2. Import Admin Components

In your admin page, import the plugin's admin components and styles:

```typescript
// app/admin/[[...params]]/page.tsx
"use client";

import "@nextlyhq/admin/styles.css";
import { RootLayout } from "@nextlyhq/admin";

// Import plugin admin components to register them
import "@nextlyhq/plugin-form-builder/admin";
// Import plugin styles
import "@nextlyhq/plugin-form-builder/styles/builder.css";
import "@nextlyhq/plugin-form-builder/styles/submissions-filter.css";

export default function AdminPage() {
  return <RootLayout />;
}
```

### 3. Run Database Sync

After adding the plugin, sync your database to create the required tables:

```bash
pnpm nextly dev --force
```

This creates two collections:

- `forms` - Stores form definitions
- `form-submissions` - Stores submitted form data

## Usage

### Admin Panel

Once installed, you'll see a new "Forms" group in the admin sidebar with:

- **Forms** - Create and edit forms using the visual builder
- **Submissions** - View and manage form submissions

### Creating a Form

1. Go to Admin > Forms > Create New Form
2. Use the drag-and-drop builder to add fields
3. Configure field properties (label, placeholder, required, etc.)
4. Set form settings (submit button text, success message)
5. Publish the form

### Public API

The plugin provides collections that can be queried via the Nextly API:

```typescript
// Get all published forms
GET /admin/api/collections/forms/entries?where={"status":{"equals":"published"}}

// Get a specific form by slug
GET /admin/api/collections/forms/entries?where={"slug":{"equals":"contact"}}

// Submit form data
POST /admin/api/collections/form-submissions/entries
{
  "form": "form-id-here",
  "data": { "name": "John", "email": "john@example.com" },
  "status": "new"
}
```

## Configuration

For customization, use the `formBuilder()` function instead of the default export:

### Custom Form Fields

Override the default form collection fields:

```typescript
import { defineConfig } from "@nextlyhq/nextly";
import { formBuilder } from "@nextlyhq/plugin-form-builder";

const myFormPlugin = formBuilder({
  formOverrides: {
    fields: defaultFields => [
      ...defaultFields,
      // Add custom fields
      text({ name: "customField", label: "Custom Field" }),
    ],
  },
});

export default defineConfig({
  plugins: [myFormPlugin.plugin],
  collections: [Posts, Users],
});
```

### Custom Access Control

```typescript
const myFormPlugin = formBuilder({
  formSubmissionOverrides: {
    access: {
      read: ({ req }) => req.user?.role === "admin",
      delete: ({ req }) => req.user?.role === "admin",
    },
  },
});
```

## Rendering Forms on Frontend

You can fetch form configurations and render them in your frontend:

```typescript
// Fetch form definition
const response = await fetch("/api/forms/contact");
const { form } = await response.json();

// Render fields based on form.fields
form.fields.map(field => {
  switch (field.blockType) {
    case "text": return <input type="text" name={field.name} />;
    case "email": return <input type="email" name={field.name} />;
    // ... handle other field types
  }
});

// Submit form
await fetch("/api/forms/contact/submit", {
  method: "POST",
  body: JSON.stringify({ data: formData }),
});
```

## Development (Monorepo)

If developing in a monorepo with pnpm workspaces, add CSS aliases to your `next.config.ts`:

```typescript
// next.config.ts (only needed for monorepo development)
const nextConfig = {
  turbopack: {
    resolveAlias: {
      "@nextlyhq/plugin-form-builder/styles/builder.css": [
        "../../packages/plugin-form-builder/dist/styles/form-builder.css",
      ],
      "@nextlyhq/plugin-form-builder/styles/submissions-filter.css": [
        "../../packages/plugin-form-builder/dist/styles/submissions-filter.css",
      ],
    },
  },
};
```

> **Note:** These aliases are only needed during monorepo development. When installed from npm, the CSS imports resolve automatically via package exports.

## License

MIT
