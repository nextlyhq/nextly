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

The package ships three CSS entry points. Pick one:

**Zero config — pre-compiled bundle**

Import the pre-built stylesheet once at your root. It bundles Tailwind, every design token
(on `:root`, flipped under `.dark`), and the base reset, so components render fully styled
with no build wiring:

```tsx
import "@nextlyhq/ui/styles.css";
import { Button } from "@nextlyhq/ui";

<Button variant="outline">Click me</Button>;
```

**Bring your own Tailwind v4 build**

If you already run Tailwind v4, import just the tokens and let your pipeline compile the
utilities the components use:

```css
/* app/globals.css */
@import "tailwindcss";
@import "@nextlyhq/ui/theme.css";
@source "../node_modules/@nextlyhq/ui/dist";
```

`theme.css` defines the tokens as complete OKLCH color values (`--nx-background`, `--nx-primary`,
`--nx-border`, …) with `@theme inline` mappings and the dark-mode overrides. Reference tokens
directly (`var(--nx-primary)`) — never wrap them in `hsl()`.

**Bring your own Tailwind v3 build**

`uiPreset` from `@nextlyhq/ui/tailwind-preset` maps the same tokens to v3 utilities:

```js
// tailwind.config.js
const { uiPreset } = require("@nextlyhq/ui/tailwind-preset");

module.exports = {
  presets: [uiPreset],
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
    // Required. Tailwind generates a utility only for a class it has SEEN, and
    // the classes these components write live in the published bundle rather
    // than in your source. Omit this path and the components render with their
    // utilities missing — no error, just unstyled markup.
    "./node_modules/@nextlyhq/ui/dist/**/*.{js,mjs,cjs}",
  ],
};
```

Import `@nextlyhq/ui/theme.css` alongside it. The preset carries tokens and the utilities
derived from them; a handful of components also write their own classes — `nx-page-shell`,
`nx-bleed`, `nx-form-section-rows` — and the rules behind those classes are CSS, shipped in
`theme.css` for every consumer alike. Scanning a component finds the class it writes, never
the rule, so a build with the preset and no stylesheet renders those components unstyled
without erroring.

> Inside a Nextly admin plugin you need neither import — the admin already provides the
> tokens. See the [**Plugin UI authoring guide**](./docs/plugin-ui-authoring.md).

## Components

**Buttons and inputs:** `Button`, `Input`, `Textarea`, `Label`
**Display:** `Badge`, `Card`, `Alert`, `Separator`, `Skeleton`, `Progress`
**Toggles:** `Checkbox`, `RadioGroup`, `Switch`, `Collapsible`
**Layout and disclosure:** `Accordion`, `Avatar`, `Tabs`, `Tooltip`, `Popover`
**Resizable regions:** `ResizablePanelGroup`, `ResizablePanel`, `ResizableHandle`
**Hierarchies:** `TreeView` (virtualized, keyboard-operable)
**Overlays:** `Dialog`, `AlertDialog`, `Sheet`
**Menus and command palette:** `DropdownMenu`, `ContextMenu`, `Select`, `Command`
**Feedback:** `Spinner`, `Toaster` (with `toast()` helper)
**Tables:** `Table` primitives, `ResponsiveTable`, `TableSearch`, `TablePagination`, `TableSkeleton`, `TableEmpty`, `TableError`, `TableLoading`
**Providers:** `PortalProvider`, `usePortalContainer`

> Which of these carry a stability guarantee is recorded in
> [STABILITY.md](https://github.com/nextlyhq/nextly/blob/main/packages/ui/STABILITY.md). A component becomes `@public` once a first-party
> plugin depends on it; everything else is `@experimental` and may change in any
> release.

**Utilities:** `cn` (from `@nextlyhq/ui/utils`), `uiPreset` (from `@nextlyhq/ui/tailwind-preset`)

> Both ship from their own subpaths rather than the root: the root bundle is
> published with `"use client"`, and neither of these contains a React runtime,
> so a server component or a Tailwind config can import them safely.

## Stylesheets

| Import                           | Use when                                                                                                                              |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `@nextlyhq/ui/styles.css`        | The app is yours end to end. Styles the whole document, Tailwind preflight included.                                                  |
| `@nextlyhq/ui/styles.scoped.css` | Dropping a few components into an existing app. Every rule is confined to `.nextly-ui`, so the rest of the page keeps its own styles. |
| `@nextlyhq/ui/theme.css`         | You compile Tailwind yourself. Carries the token contract and the component rules; required on both the v4 and the v3-preset path.    |

The scoped sheet needs a wrapper element, and dark mode goes on the same element:

```tsx
import "@nextlyhq/ui/styles.scoped.css";

<div className="nextly-ui">
  <Button>Save</Button>
</div>;
```

It keeps preflight rather than dropping it — these components are designed against a
normalised baseline — but confines it to the wrapper, so your headings, lists and form
controls outside it are untouched. Three things CSS resolves globally are namespaced
along with the selectors, so the sheet cannot reach outside the wrapper through them
either: animation names (it will not displace a `spin` or `fade-in` you define),
Tailwind's internal `--tw-*` registrations, and the ancestor classes `dark:` and
`group-*:` variants look for. Dark mode is therefore driven by the wrapper, not by a
`dark` class higher up your page.

### Overlays need a portal container

AlertDialog, Command, ContextMenu, Dialog, DropdownMenu, Popover, Select, Sheet and
Tooltip render
their overlay through a portal, which defaults to `document.body` — outside the wrapper,
where the scoped rules and tokens do not reach. Triggers would look right and the menus
they open would not. Point them back inside with `PortalProvider`:

```tsx
import { useState } from "react";
import { PortalProvider } from "@nextlyhq/ui";
import "@nextlyhq/ui/styles.scoped.css";

function Kit({ children }: { children: React.ReactNode }) {
  const [container, setContainer] = useState<HTMLElement | null>(null);

  return (
    <div className="nextly-ui" ref={setContainer}>
      <PortalProvider container={container}>{children}</PortalProvider>
    </div>
  );
}
```

A callback ref rather than `useRef` because the container has to be a state value: on the
first render it is still `null`, and the overlays need a re-render once the element exists.

This does not apply to `styles.css`, where the rules are document-wide and
`document.body` is already covered.

## Compatibility

| Tool           | Version                                                                                  |
| -------------- | ---------------------------------------------------------------------------------------- |
| React          | 18 or 19                                                                                 |
| Tailwind CSS   | 4+ (`@nextlyhq/ui/tailwind-preset` also works as a Tailwind v3 preset, with `theme.css`) |
| `lucide-react` | 0.400+                                                                                   |

## Documentation

- [**Plugin UI authoring guide**](./docs/plugin-ui-authoring.md): the token contract, dark mode, container queries, and the design lint guard
- [**Admin customization**](https://nextlyhq.com/docs/admin/customization): theming, branding, and custom field UIs

## Related packages

- [`@nextlyhq/admin`](../admin): uses these components throughout the admin panel
- [`nextly`](../nextly): the core runtime

## License

[MIT](../../LICENSE.md)
