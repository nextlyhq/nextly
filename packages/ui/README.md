# @revnixhq/ui

Headless React component library for Nextly's admin panel, plugins, and any custom UI you build on top.

<p align="center">
  <a href="https://www.npmjs.com/package/@revnixhq/ui"><img alt="npm" src="https://img.shields.io/npm/v/@revnixhq/ui?style=flat-square&label=npm&color=cb3837" /></a>
  <a href="https://github.com/nextlyhq/nextly/blob/main/LICENSE.md"><img alt="License" src="https://img.shields.io/github/license/nextlyhq/nextly?style=flat-square&color=blue" /></a>
  <a href="https://nextlyhq.com/docs"><img alt="Status" src="https://img.shields.io/badge/status-alpha-orange?style=flat-square" /></a>
</p>

> [!IMPORTANT]
> Nextly is in alpha. APIs may change before 1.0. Pin exact versions in production.

## What it is

A shadcn/ui-flavored component set built on Radix primitives, `class-variance-authority`, and Tailwind. The same components power the admin panel; you can use them in your own custom admin views, plugin UIs, or marketing pages.

Install this whenever you want admin-consistent UI in a Nextly extension or a frontend that should match the admin look.

## Installation

```bash
pnpm add @revnixhq/ui
```

Peer dependencies:

```bash
pnpm add react react-dom lucide-react
```

## Setup

Register the Tailwind preset in your `tailwind.config.ts`:

```ts
import { uiPreset } from "@revnixhq/ui";

export default {
  presets: [uiPreset],
  content: ["./src/**/*.{ts,tsx}", "./node_modules/@revnixhq/ui/dist/**/*.js"],
};
```

Then import any component:

```tsx
import { Button } from "@revnixhq/ui";

<Button variant="outline">Click me</Button>;
```

## Components

**Buttons & Inputs:** `Button`, `Input`, `Textarea`, `Label`
**Display:** `Badge`, `Card`, `Alert`, `Separator`, `Skeleton`, `Progress`, `Avatar`, `Spinner`
**Toggles:** `Checkbox`, `RadioGroup`, `Switch`, `Collapsible`
**Overlays:** `Dialog`, `AlertDialog`, `Sheet`, `Popover`, `Tooltip`
**Menus:** `DropdownMenu`, `Select`, `Command`, `Tabs`, `Accordion`
**Tables:** `Table`, `ResponsiveTable`, `TableSearch`, `TablePagination`, `TableSkeleton`, `TableEmpty`, `TableError`, `TableLoading`
**Other:** `Toaster`, `toast`, `cn`, `PortalProvider`, `uiPreset`

## Compatibility

- React 18 or 19
- Tailwind CSS 3.4+ (or 4 with the same preset)
- `lucide-react` 0.400+

## Documentation

**[UI components docs →](https://nextlyhq.com/docs/admin/customization)**

## Related packages

- [`@revnixhq/admin`](../admin) – uses these components throughout
- [`@revnixhq/nextly`](../nextly) – the runtime
- [`@revnixhq/client`](../client) – data fetching

## License

[MIT](../../LICENSE.md)
