# @nextlyhq/admin

The admin dashboard and management interface for Nextly. Mounts at `/admin` in your Next.js app.

<p align="center">
  <a href="https://www.npmjs.com/package/@nextlyhq/admin"><img alt="npm" src="https://img.shields.io/npm/v/@nextlyhq/admin?style=flat-square&label=npm&color=cb3837" /></a>
  <a href="https://github.com/nextlyhq/nextly/blob/main/LICENSE.md"><img alt="License" src="https://img.shields.io/github/license/nextlyhq/nextly?style=flat-square&color=blue" /></a>
  <a href="https://nextlyhq.com/docs"><img alt="Status" src="https://img.shields.io/badge/status-alpha-orange?style=flat-square" /></a>
</p>

> [!IMPORTANT]
> Nextly is in alpha. APIs may change before 1.0. Pin exact versions in production.

## What it is

`@nextlyhq/admin` ships the React admin panel: collection list views, entry editors, the field UI registry, the visual Schema Builder, the media library, and user/role management. It runs inside your Next.js app's App Router, not as a separate server.

Install this whenever you want a `/admin` UI in your Nextly project. Skip it if you only need the API surface from `nextly`.

## Installation

```bash
pnpm add @nextlyhq/admin
```

Peer dependencies (must be installed in the consuming project):

```bash
pnpm add nextly @nextlyhq/ui lucide-react react react-dom next
```

## Quick usage

Mount the admin under a catch-all App Router route. This needs two files: a `page.tsx` with the admin UI tree, and a `layout.tsx` that injects branding CSS for the first paint.

**`app/admin/[[...params]]/page.tsx`**

```tsx
"use client";

import "@nextlyhq/admin/style.css";
import { RootLayout, QueryProvider, ErrorBoundary } from "@nextlyhq/admin";

export default function AdminPage() {
  return (
    <ErrorBoundary
      onError={(error, errorInfo) => {
        console.error("Admin error:", error, errorInfo);
      }}
    >
      <QueryProvider>
        <RootLayout />
      </QueryProvider>
    </ErrorBoundary>
  );
}
```

**`app/admin/[[...params]]/layout.tsx`**

```tsx
import { getBrandingCss } from "nextly/config";

import config from "../../../../nextly.config";

const brandingCss = getBrandingCss(config.admin?.branding);

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      {brandingCss && (
        <style dangerouslySetInnerHTML={{ __html: brandingCss }} />
      )}
      {children}
    </>
  );
}
```

The `QueryProvider` is required (the admin uses TanStack Query throughout); the `ErrorBoundary` is recommended so unexpected errors do not blank the panel. The branding `<style>` block runs server-side to avoid a flash of default colors before your custom theme loads.

After running `pnpm dev`, visit [http://localhost:3000/admin/setup](http://localhost:3000/admin/setup) to create the first admin user.

## Main exports

**Mount points and providers**

- `RootLayout`: the top-level admin component, mounted by your catch-all route
- `QueryProvider`: TanStack Query client wrapper (required)
- `ThemeProvider`, `useTheme`: light/dark theme toggle
- `BrandingProvider`, `useBranding`: customize logo and admin branding
- `ErrorBoundary`, `QueryErrorBoundary`: error containment

**TanStack Query hooks** (read live admin data from your own components)

- `useUsers`, `useRoles`
- `useCollection`, `useCollections`
- `useMedia`, `useMediaItem`
- `useDashboardStats`, `useRecentActivity`
- `useBulkMutation`, `useRowSelection`, `useDebouncedValue`

**UI primitives** (re-exported from [`@nextlyhq/ui`](../ui))

- `Button`, `Input`, `Textarea`, `Checkbox`, `RadioGroup`, `Select`, `Badge`, `Skeleton`, `Spinner`, and more
- `Toaster`, `toast` for notifications

## Compatibility

| Tool     | Version                   |
| -------- | ------------------------- |
| Next.js  | 16+ (App Router required) |
| React    | 19+                       |
| `nextly` | 0.0.x                     |

## Documentation

- [**Admin overview**](https://nextlyhq.com/docs/admin)
- [**Customization**](https://nextlyhq.com/docs/admin/customization): theme, branding, custom field UIs
- [**Branding**](https://nextlyhq.com/docs/admin/branding): logos, colors, and identity
- [**Visual Schema Builder**](https://nextlyhq.com/docs/admin/builder)

## Related packages

- [`nextly`](../nextly): the core runtime
- [`@nextlyhq/ui`](../ui): the underlying component library
- [`@nextlyhq/plugin-form-builder`](../plugin-form-builder): drag-and-drop form builder admin views

## License

[MIT](../../LICENSE.md)
