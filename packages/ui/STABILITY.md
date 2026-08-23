# UI kit stability

`@nextlyhq/ui` is the **presentational** half of the plugin-author surface: the React
primitives the admin itself is built from. This document is the authoritative ledger of
what is **stable (`@public`)** versus **`@experimental`**, and the guarantees behind each.

It follows the same rules as
[`@nextlyhq/plugin-sdk`'s ledger](../plugin-sdk/STABILITY.md), which covers the other
half of the surface — registration, contributions, the data table and the field-UI kit.
Plugin authors use both:

| Need                                                                | Import from                           |
| ------------------------------------------------------------------- | ------------------------------------- |
| Registering components, contribution types, DataTable, field-UI kit | `@nextlyhq/plugin-sdk` (and `/admin`) |
| Buttons, inputs, dialogs, tables and the design tokens              | `@nextlyhq/ui`                        |
| A pure class-name helper (`cn`)                                     | `@nextlyhq/ui/utils`                  |
| The Tailwind v3 preset                                              | `@nextlyhq/ui/tailwind-preset`        |

> **Never import from `@nextlyhq/admin`.** It is an application, not a published API.
>
> Export clauses are annotated with a TSDoc release tag (`@public` / `@experimental`)
> that mirrors the tables below. When the JSDoc and this table disagree, **this table
> wins** — please open an issue.

## How a surface becomes stable

Same ladder as the plugin SDK (D55): nothing is declared stable on paper. An export
graduates from `@experimental` to `@public` only once **a first-party plugin has
exercised it**. The `@public` list below is derived from exactly that — what
`plugin-form-builder` and `plugin-page-builder` import today — rather than from what
looks finished.

The public surface is kept **deliberately small** (D40). Everything not listed as
`@public` is `@experimental` and may change in any release.

One export graduates on a second route: **what a `@public` artifact requires in order to
work.** `styles.scoped.css` is public, and overlays portal to `document.body` — outside
the wrapper the scoped rules are confined to — so `PortalProvider` is mandatory for the
documented setup. Promising the stylesheet is stable while the only correct way to use it
may change in any release would not be a real guarantee, so the two move together.

## The semver guarantee

The `@public` surface is the semver-protected contract. After `1.0`, breaking a
`@public` export requires a major bump. During the `0.x` alpha it is _stable-in-intent_:
changes follow the deprecation policy rather than landing as silent breaks, but pin your
`@nextlyhq/ui` version while we are pre-`1.0`.

`@experimental` exports carry **no compatibility guarantee**.

A change to any export — public or experimental — has to pass the surface snapshot in
`src/ui-surface.test.ts`, which tracks each export's **name and kind**. Turning a
runtime value into a type-only export keeps the name but breaks consumers at runtime, so
that swap fails the snapshot too.

## Stable surface (`@public`)

| Group         | Exports                                                                                                                               | First-party exerciser      |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| Form controls | `Button`, `Input`, `Textarea`, `Label`, `Checkbox`, `Switch`, `FormLabelWithTooltip`                                                  | form-builder, page-builder |
| Select        | `Select`, `SelectTrigger`, `SelectValue`, `SelectContent`, `SelectItem`                                                               | form-builder, page-builder |
| Radio         | `RadioGroup`, `RadioGroupItem`                                                                                                        | form-builder               |
| Display       | `Badge`                                                                                                                               | form-builder, page-builder |
| Tabs          | `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent`                                                                                      | form-builder, page-builder |
| Dialog        | `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogDescription`, `DialogFooter`                                         | page-builder               |
| Sheet         | `Sheet`, `SheetContent`, `SheetHeader`, `SheetTitle`, `SheetDescription`                                                              | page-builder               |
| Dropdown menu | `DropdownMenu`, `DropdownMenuTrigger`, `DropdownMenuContent`, `DropdownMenuItem`, `DropdownMenuCheckboxItem`, `DropdownMenuSeparator` | page-builder               |
| Tooltip       | `Tooltip`, `TooltipTrigger`, `TooltipContent`                                                                                         | form-builder, page-builder |
| Notifications | `toast`                                                                                                                               | admin, page-builder        |
| Design tokens | `theme.css`, `styles.css`, `styles.scoped.css`, and the `--nx-*` custom properties they define                                        | admin, all plugins         |
| Portals       | `PortalProvider`, `usePortalContainer`                                                                                                | admin, `styles.scoped.css` |

| Prop types | `ButtonProps`, `InputProps`, `FormLabelWithTooltipProps`, `BadgeProps`, `TabsProps`, `TabsListProps`, `TabsTriggerProps`, `TabsContentProps`, `DialogContentProps`, `DialogHeaderProps`, `DialogFooterProps`, `DialogTitleProps`, `DialogDescriptionProps`, `DropdownMenuContentProps`, `DropdownMenuItemProps`, `DropdownMenuCheckboxItemProps`, `DropdownMenuSeparatorProps`, `SelectTriggerProps`, `SheetProps`, `SheetContentProps`, `SheetHeaderProps`, `SheetTitleProps`, `SheetDescriptionProps` | form-builder, page-builder |

Prop types carry the same guarantee as the component they belong to. That is not
a convention anyone has to remember: a stable component you cannot type the
props of is not usable stably, since wrapping it or forwarding to it needs the
type. The rule is enforced by a test rather than stated, because it had drifted
on twenty of them — every one tagged weaker than the component it belongs to, so
the published type advertised less than the component actually promised.

## Experimental surface (`@experimental`)

Everything else the barrel exports, including: `Accordion`, `Alert`, `AlertDialog`,
`Avatar`, `Card`, `Collapsible`, `Command`, `ContextMenu` and its family, `Popover`,
`Progress`, `ResizablePanelGroup`/`ResizablePanel`/`ResizableHandle`, `Separator`,
`Skeleton`, `Slider`, `Spinner`, `Table` and its family, `TableSearch`, `TableSkeleton`,
`TreeView`, the table state components, the layout primitives (`Stack`, `Grid`, `Stat`,
`PageShell`, `Bleed`),
`Toaster` and the shortcut manager (`ShortcutProvider`, `ShortcutScope`, `useShortcuts`,
`useShortcutManager`, `useActiveShortcuts`, `createShortcutManager`, `parseKeys`).

`Slider` (with `SliderThumbProps`) joins them for the inspector: a bounded numeric property — opacity, blur radius,
letter spacing, a colour's alpha — is the single most repeated control in an editing surface,
and a hand-rolled one gets pointer capture, step rounding and the per-thumb ARIA pattern wrong
quietly. Its `value` is an array even for one thumb, which is what makes a range slider the
same component rather than a second one.

The shortcut manager is the third editor-shell primitive, and the one that cannot live in a
plugin at all: its whole purpose is to be the only listener, so a plugin shipping its own copy
would recreate the ambiguity it exists to remove. It is a peer dependency of correctness for
any surface with a keyboard grammar.

Single-listener behaviour is a property a surface OPTS INTO by registering through the manager.
Existing `document` and `window` handlers keep working and keep competing with each other until
they adopt it; the manager stands down for a key another owner has already claimed, but it
cannot arbitrate between two listeners that never told it they exist.

The context menu and the resizable split are the editor-shell primitives: an editor needs
a right-click menu and draggable regions, and both belong in the kit rather than inside
one plugin, because every plugin that builds an editing surface needs the same two. They
enter experimental like everything else — the ladder does not make exceptions for the
component that motivated it.

These are shipped and used by the admin, but no first-party plugin depends on them yet,
so they have not met the graduation bar. Use them — that is what promotes them — but
expect them to move.

`cn` (`@nextlyhq/ui/utils`) and `uiPreset` (`@nextlyhq/ui/tailwind-preset`) are
`@experimental` as entry points: the functions are trivial and unlikely to change, but
the subpaths are new and unexercised by any third party.

`FieldShell` (with `FieldShellProps`, `FieldShellRenderProps` and `FieldWidth`) is the
atom of the form-layout kit: a labelled row that caps its control's width to a named
token rather than a one-off measurement. It owns its own prop merge with `cloneElement`
rather than delegating to Radix `Slot`, so there is exactly one implementation of "what
props does the control end up with" and it is not subject to another library's
precedence rules. `htmlFor` is optional: when omitted, `FieldShell` generates an id with
`useId()` and puts it on the label; a non-empty `id` the child already carries wins over
that generated id (an explicitly-present `id={undefined}` does not), and the label
always targets whichever id the control actually ends up with. Pass `htmlFor` explicitly
only when the caller already manages its own id. `FieldShell` also owns the control's
ARIA wiring: it generates ids for `description` and `error` (only for whichever are
actually rendered) and COMPOSES them onto the control's `aria-describedby` alongside any
ids the child already listed there, rather than replacing them; the attribute is omitted
entirely when the result would be empty. A rendered `error` always forces
`aria-invalid="true"`, overriding whatever the child set; with no error, the child's own
`aria-invalid` passes through untouched.

`children` accepts EITHER a single `ReactElement` (cloned, as above) OR a function of
type `(field: FieldShellRenderProps) => ReactNode`, called with the SAME `{ id,
describedBy, invalid }` the clone path would have applied — both derive from one shared
computation, so the two forms cannot silently drift into answering "what does the
control get" differently. The element form must not be a `Fragment` — nothing can
forward props through one — which `FieldShell` detects at runtime and reports via
`devWarnOnce` rather than throwing, since no compile-time check can rule it out. The
function form exists for a compound control built on a Radix `Root` (`Select`, and by
the same shape `RadioGroup`): `Root` destructures a fixed, named prop list and never
spreads the remainder, so an id `cloneElement` attaches to it never reaches the actual
focusable element nested inside (`SelectTrigger`, two levels down); the caller applies
the wiring to that nested element itself instead. In development, `FieldShell` checks
after mount whether the id it computed landed on any element in the document at all —
regardless of which `children` form was used — and warns once, by name, if it did not:
a compound control silently dropping the id is otherwise indistinguishable from one that
correctly wired it up, since nothing throws and nothing else warns either way. No
first-party plugin exercised `FieldShell` in production until `plugin-form-builder`'s
Notifications and Status fields adopted the function form for their `Select` controls,
so it has not yet met the graduation bar.

`FormSection` (with `FormSectionProps`) is the form-layout kit's section: a labelled
card holding a group of fields. It composes `Card` for its container rather than
hand-rolling its own border and background, so it carries `Card`'s CONTAINER radius
tier. It has no footer slot — a form commits as one document, so its action belongs
to the page rather than to a section. The visible label stays a `<p>`, not a heading —
heading level is a document-structure decision this component cannot make on its
own — and the `<section>` names itself via `aria-labelledby` pointing at that label's
generated id, so the region still has a programmatic name for landmark navigation. No
first-party plugin exercises it yet, so it has not met the graduation bar.

`Grid` gained an opt-in `responsive` prop: off by default (so every existing caller
keeps its fixed column count, with no wrapper element added), and when set the grid
renders its own unnamed `@container` wrapper and starts at one column, widening on
that wrapper's own breakpoint rather than the viewport's or any ancestor's — so it
works wherever it is mounted, with no dependency on a named container declared
elsewhere in the tree. In responsive mode the wrapper is what actually participates
in the parent's layout, so `className`, `style`, the remaining HTML attributes and
`ref` land on IT rather than the inner grid; `cols` and `gap` describe the grid's own
internal layout and stay on the inner element in both modes. Non-responsive mode is
unchanged: one element, everything on it. No first-party plugin exercises this prop
yet, so `Grid` stays on the experimental list above.

`FormLayout` (with `FormLayoutProps` and `FormMeasure`) is the form-layout kit's page
measure: it centres a bounded column so pages stop each hand-rolling their own width,
and takes an opt-in `wide` variant for denser forms. `FormActions` (with
`FormActionsProps`) is its single action bar, sticky to the bottom of the measure —
there is deliberately no per-section footer, for the same reason `FormSection` has
none. `FormActions` never computes its `dirty` flag; the page passes it down from the
form state that already tracks it, so `@nextlyhq/ui` never depends on
`react-hook-form`. No first-party plugin exercises either yet, so both stay on the
experimental list above.

`PageShell` (with `PageShellProps`) and `Bleed` (with `BleedProps`) own the page's
horizontal inset and its measure, spent as GRID COLUMNS rather than as padding. The
distinction is the reason they exist rather than being a styling preference: padding
cannot be cancelled by a descendant, so under the previous arrangement a block that
needed to run edge-to-edge had to be rendered OUTSIDE the wrapper imposing the measure —
and two wrappers that each applied an inset silently added theirs together. As columns
there is one declaration of the inset, double-padding is unrepresentable, and `Bleed`
turns full-bleed from an accident into a declaration.

`Bleed` is valid only as a DIRECT child of `PageShell`, because the `full-start` and
`full-end` lines are named on the shell's own grid and are in scope nowhere else. Nested
deeper it renders a plain block and the `grid-column` is inert — which looks finished and
is not full-bleed — so the constraint is pinned by test rather than left to the reader.

`PageShell` deliberately applies no horizontal padding of its own; a `px-*` utility on it
would be the second declaration this design exists to remove. Neither is exercised by a
first-party plugin yet, so both stay on the experimental list above.

## Peer dependency policy

`@nextlyhq/ui` is a **peer** dependency of `@nextlyhq/admin`, not a bundled one, and must
resolve to a **single copy** in an install tree. It ships React context
(`PortalProvider`), and a second copy means a second context — portals and dialogs then
render into the wrong container, with no error.

The same applies to the packages it leaves external:

| Package                | Why it is external                                                                                              |
| ---------------------- | --------------------------------------------------------------------------------------------------------------- |
| `react`, `react-dom`   | Duplicate React is the classic hooks/context failure.                                                           |
| `@radix-ui/*`          | Portal, focus and dismiss state lives in module scope; two copies break focus traps and outside-click handling. |
| `sonner`               | Keeps its toast queue in module state — a second copy publishes toasts nothing renders.                         |
| `cmdk`, `lucide-react` | Consumer-resolved so the app controls the version.                                                              |

**Radix version skew.** Radix packages are listed in `dependencies` and marked external
at build time, so the consumer resolves them. A plugin that pins a different major of a
Radix package it shares with the kit (`@radix-ui/react-dialog`, `-dropdown-menu`,
`-popover`, `-tooltip`, `-select`) can end up with two copies and broken portal or focus
behaviour. Plugins should therefore **not** depend on `@radix-ui/*` directly — compose
from `@nextlyhq/ui` instead. If a primitive is missing, open an issue so it can be added
to the kit rather than pulled in alongside it.

## Deprecation policy

When a `@public` export must change incompatibly:

1. **Mark it `@deprecated`** in JSDoc with the replacement and the version it will be
   removed in.
2. **Keep it for ≥ 1 major version** after deprecation.
3. **Ship a migration note** in the changeset before removal.

`@experimental` exports may be changed or removed without this process — that is the
trade for using them early.

## Out of scope

- **Theming beyond the tokens.** Override `--nx-*` values; do not depend on class names,
  DOM structure or Radix internals, none of which are part of the contract.
- **Server components.** The root barrel is published with `"use client"`. Only
  `@nextlyhq/ui/utils`, `@nextlyhq/ui/tailwind-preset` and `@nextlyhq/ui/color`
  are importable from server code.

`@nextlyhq/ui/color` is `@experimental`: conversions between sRGB, HSV and OKLCH. It sits on
the server-safe side deliberately — the functions are arithmetic on numbers, and a colour a
server renders should not have to cross into client code to be converted. The OKLCH direction
reduces chroma to reach the displayable gamut, so a colour outside sRGB is approximated by one
of the same hue rather than a different one.
