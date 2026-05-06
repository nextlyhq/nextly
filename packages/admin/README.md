# @revnixhq/admin

The admin dashboard and management interface for Nextly. Mounts at `/admin` in your Next.js app.

<p align="center">
  <a href="https://www.npmjs.com/package/@revnixhq/admin"><img alt="npm" src="https://img.shields.io/npm/v/@revnixhq/admin?style=flat-square&label=npm&color=cb3837" /></a>
  <a href="https://github.com/nextlyhq/nextly/blob/main/LICENSE.md"><img alt="License" src="https://img.shields.io/github/license/nextlyhq/nextly?style=flat-square&color=blue" /></a>
  <a href="https://nextlyhq.com/docs"><img alt="Status" src="https://img.shields.io/badge/status-alpha-orange?style=flat-square" /></a>
</p>

> [!IMPORTANT]
> Nextly is in alpha. APIs may change before 1.0. Pin exact versions in production.

## What it is

`@revnixhq/admin` ships the React admin panel: collection list views, entry editors, the field UI registry, the visual Schema Builder, the media library, and user/role management. It runs inside your Next.js app's App Router, not as a separate server.

Install this whenever you want a `/admin` UI in your Nextly project. Skip it if you only need the API surface from `@revnixhq/nextly`.

## Installation

```bash
pnpm add @revnixhq/admin
```

Peer dependencies (must be installed in the consuming project):

```bash
pnpm add @revnixhq/nextly react react-dom next
```

## Quick usage

Mount the admin under a catch-all App Router route (`app/admin/[[...params]]/page.tsx`):

```tsx
"use client";

import "@revnixhq/admin/style.css";
import { RootLayout } from "@revnixhq/admin";

export default function AdminPage() {
  return <RootLayout />;
}
```

After running `pnpm dev`, visit `http://localhost:3000/admin/setup` to create the first admin user.

## Main exports

- [`RootLayout`](https://nextlyhq.com/docs/admin) – the top-level admin component, mounted by your catch-all route
- [`ThemeProvider`](https://nextlyhq.com/docs/admin/customization), `useTheme` – light/dark theme toggle
- [`BrandingProvider`](https://nextlyhq.com/docs/admin/customization), `useBranding` – customize logo and admin branding
- [`QueryProvider`](https://nextlyhq.com/docs/admin/customization) – TanStack Query client wrapper
- TanStack Query hooks for users, roles, permissions, collections, and media (e.g. `useUsers`, `useRoles`, `useCollection`)

## Compatibility

- Next.js 15+
- React 18 or 19
- `@revnixhq/nextly` 0.0.x

## Documentation

**[Admin docs →](https://nextlyhq.com/docs/admin)**

## Related packages

- [`@revnixhq/nextly`](../nextly) – the core runtime
- [`@revnixhq/client`](../client) – browser-side type-safe client (in development)
- [`@revnixhq/ui`](../ui) – the underlying component library

## License

[MIT](../../LICENSE.md)
