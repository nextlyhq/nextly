# @nextlyhq/ui

Headless React component library for Nextly's admin panel, plugins, and any custom UI you build on top.

<p align="center">
  <a href="https://www.npmjs.com/package/@nextlyhq/ui"><img alt="npm" src="https://img.shields.io/npm/v/@nextlyhq/ui?style=flat-square&label=npm&color=cb3837" /></a>
  <a href="https://github.com/nextlyhq/nextly/blob/main/LICENSE.md"><img alt="License" src="https://img.shields.io/github/license/nextlyhq/nextly?style=flat-square&color=blue" /></a>
  <a href="https://nextlyhq.com/docs"><img alt="Status" src="https://img.shields.io/badge/status-alpha-orange?style=flat-square" /></a>
</p>

> [!IMPORTANT]
> Nextly is in alpha. APIs may change before 1.0. Pin exact versions in production.

## What it is

A shadcn/ui-flavored component set built on Radix primitives, `class-variance-authority`, and Tailwind CSS. The same components power the Nextly admin panel; you can use them in your own custom admin views, plugin UIs, or marketing pages.

Install this whenever you want admin-consistent UI in a Nextly extension or a frontend that should match the admin look.

## Installation

```bash
pnpm add @nextlyhq/ui
```

Peer dependencies (must be installed in the consuming project):

```bash
pnpm add react react-dom lucide-react
```

## Setup

The components ship as Tailwind CSS 4 token consumers. They reference HSL CSS variables (`--background`, `--primary`, `--border`, etc.) which your project must define.

**Tailwind v4 (recommended)**

In your global CSS, define the design tokens with `@theme` and import the components:

```css
/* app/globals.css */
@import "tailwindcss";

@theme {
  --color-background: hsl(0 0% 100%);
  --color-foreground: hsl(222 47% 11%);
  --color-primary: hsl(221 83% 53%);
  --color-primary-foreground: hsl(0 0% 100%);
  /* ...the rest. See `uiPreset` for the full token contract. */
}
```

The exported `uiPreset` is the reference contract: it lists every token name the components expect. Use it to write the matching `@theme` block (or import it directly if you are still on Tailwind v3).

```tsx
import { Button } from "@nextlyhq/ui";

<Button variant="outline">Click me</Button>;
```

## Components

**Buttons and inputs:** `Button`, `Input`, `Textarea`, `Label`
**Display:** `Badge`, `Card`, `Alert`, `Separator`, `Skeleton`, `Progress`
**Toggles:** `Checkbox`, `RadioGroup`, `Switch`, `Collapsible`
**Layout and disclosure:** `Accordion`, `Avatar`, `Tabs`, `Tooltip`, `Popover`
**Overlays:** `Dialog`, `AlertDialog`, `Sheet`
**Menus and command palette:** `DropdownMenu`, `Select`, `Command`
**Feedback:** `Spinner`, `Toaster` (with `toast()` helper)
**Tables:** `Table` primitives, `ResponsiveTable`, `TableSearch`, `TablePagination`, `TableSkeleton`, `TableEmpty`, `TableError`, `TableLoading`
**Providers:** `PortalProvider`, `usePortalContainer`
**Utilities:** `cn`, `uiPreset`

## Compatibility

| Tool           | Version                                                          |
| -------------- | ---------------------------------------------------------------- |
| React          | 18 or 19                                                         |
| Tailwind CSS   | 4+ (the `uiPreset` JS export also works as a Tailwind v3 preset) |
| `lucide-react` | 0.400+                                                           |

## Documentation

- [**Admin customization**](https://nextlyhq.com/docs/admin/customization): theming, branding, and custom field UIs

## Related packages

- [`@nextlyhq/admin`](../admin): uses these components throughout the admin panel
- [`nextly`](../nextly): the core runtime

## License

[MIT](../../LICENSE.md)
