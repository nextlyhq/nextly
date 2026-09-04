# @nextlyhq/builder

The visual page-builder editor: the shell, the canvas, and the op store that
everything in it either produces or reads.

<p align="center">
  <a href="https://www.npmjs.com/package/@nextlyhq/builder"><img alt="npm" src="https://img.shields.io/npm/v/@nextlyhq%2Fbuilder?style=flat-square&label=npm&color=cb3837" /></a>
  <a href="https://github.com/nextlyhq/nextly/blob/main/LICENSE.md"><img alt="License" src="https://img.shields.io/github/license/nextlyhq/nextly?style=flat-square&color=blue" /></a>
  <a href="https://nextlyhq.com/docs"><img alt="Status" src="https://img.shields.io/badge/status-alpha-orange?style=flat-square" /></a>
</p>

> [!IMPORTANT]
> Nextly is in alpha. APIs may change before 1.0. Pin exact versions in production.
> **Every export of this package is additionally `@experimental`** and carries no
> compatibility guarantee even within alpha.

The editor is landing in slices. What
ships today is the editor SHELL — the rail, the switched left panel, the canvas
slot, the inspector and the bars around them — the frame geometry that maps
between the canvas frame and the host page, the op store that every edit is
expressed in, and the package name constant. The canvas is still to come. See
[Public surface](#public-surface).

The package was created ahead of any of it so its name could be claimed on npm:
trusted publishing cannot perform a package's first publish, and the bootstrap
script will not claim a name that is not already a workspace package.

## What this package is not

**It is not a renderer.** The canvas draws documents through
`@nextlyhq/blocks-react` — the same renderer that serves published pages — and
re-implements nothing downstream of the document model. Read-path preparation,
condition gating and slot pruning are consumed from the engine's own entry
points, never reproduced here.

That rule is not stylistic. `plugin-page-builder` carries a second renderer of
its own, and the two disagree about condition gating in opposite directions: one
fails closed, the other does not evaluate conditions at all. Sharing a predicate
would not have prevented that, because sharing a predicate does not share the
decision to call it. Only sharing the entry point does.

## The layering contract

`src/layering.test.ts` enforces two boundaries as a build failure:

**The strongest enforcement is not the scan.** `@nextlyhq/admin` is in no
dependency field of this package, and pnpm's `node_modules` is not hoisted, so it
does not resolve here at all — verified, `MODULE_NOT_FOUND`. Every spelling of a
direct admin import therefore fails to build, including spellings TypeScript has
not shipped yet. A test asserts the manifest stays that way, which is complete by
construction in a way a syntax scan can never be.

The scan is the second layer: it fails at test time naming the rule, rather than
at build time with a resolution error, and it is the **only** enforcement for the
subpath policy below — `blocks-react/next`, the `plugin-sdk` root and
`plugin-sdk/testing` all resolve perfectly, because their packages are legitimate
dependencies. The graph has nothing to say about which _entry_ of a dependency is
allowed.

1. **Never `@nextlyhq/admin` directly.** Admin is reached only through
   `@nextlyhq/plugin-sdk/admin`, a curated facade where every export is named
   individually and carries a stability tag. A direct import bypasses the facade
   and takes a dependency on internals nobody promised to keep. The pull toward
   it is concrete: the editor wants admin's Lexical node set for inline rich
   text.
2. **Never the CMS runtime.** The allowlist is **exact specifiers**, not
   packages, because subpaths are where the coupling lives —
   `@nextlyhq/blocks-react/next` imports `nextly/runtime`, and the
   `@nextlyhq/plugin-sdk` root re-exports runtime values from `nextly`. Only
   `@nextlyhq/plugin-sdk/admin` is admitted, and only the root entry of
   `blocks-react`.

The guard reads every shape that reaches a module — static imports and
re-exports, `import()`, bare `require()`, `import x = require()`,
`typeof import()`, and triple-slash type references — because each of those has,
at some point, walked straight past a narrower version of it.

**What the guard does NOT prove:** that the canvas renders _through_
`blocks-react` rather than reimplementing rendering on React and
`blocks-engine`. Both spellings import exactly the same packages, so no import
scan can separate them. That rule is held by review. The allowlist makes the
shortcut inconvenient; it cannot make it impossible.

Adding an allowlist entry is a deliberate act with a reason recorded beside it.

## Public surface

`BUILDER_PACKAGE_NAME` — this package's npm name, for diagnostics that report
which packages a host loaded. The name and not the version: a version literal in
source would be stale one release after it was written, because every release
bumps this package in lockstep with its siblings.

### The editor shell

```tsx
import { BuilderShell } from "@nextlyhq/builder/shell";
import "@nextlyhq/ui/styles.css"; // the design system's — see below
import "@nextlyhq/builder/styles.css"; // the editor chrome's

<BuilderShell
  onExit={() => router.push("/admin/pages")}
  renderPanel={panel => <MyPanel kind={panel} />}
  inspector={<MyInspector />}
  topBar={<MyTopBar />}
  breadcrumb={<MyBreadcrumb />}
>
  <MyCanvas />
</BuilderShell>;
```

**Two stylesheets, and both are required.**

`@nextlyhq/builder/styles.css` is COMPILED rather than a token file: it carries
the shell's own utility rules as well as the `--nx-builder-*` custom properties,
so the chrome lays out with no Tailwind setup in the host.

It SUPPLEMENTS the design system's stylesheet rather than restating it, so
`@nextlyhq/ui/styles.css` is loaded alongside — or the admin's stylesheet, which
already contains it, when the editor is mounted inside the admin. That sheet
owns three things this one deliberately does not ship:

- the `--nx-*` tokens the chrome's own colours are derived from,
- the base reset the components are designed against,
- the rules for the primitives the shell renders — tooltips and drag handles.

Shipping a second copy of any of them would make the result depend on which
stylesheet loaded last, and would break re-theming: the point of deriving from
`--nx-*` is that a host which re-themes the admin moves the editor with it.

If the design system's sheet is missing, the shell says so in the console in
development rather than leaving you to diagnose colours that resolve to nothing.

If you DO use Tailwind and want to re-theme or extend the chrome, apply
`@nextlyhq/ui/tailwind-preset` and add this package to your `@source` scan. That
is optional — the compiled sheet already works — and it is what lets your own
classes sit alongside the shell's without a second Tailwind build.

**The stylesheet is not optional and nothing will tell you if you forget it.**
The shell renders its markup, carries its class names, and lays out as a stack
of full-width blocks — which reads as a layout bug rather than a missing import.
It is a separate subpath because a stylesheet a bundler cannot tree-shake should
be a decision the host makes, not a side effect of importing a component.

**The shell is presentational, and that is a contract rather than a current
state.** It owns which panel is open and how wide the regions are — chrome
state, its own business. It owns nothing about the document, so selection
arrives as a prop.

That split is not tidiness. Document ops INVALIDATE selection: a remove deletes
the selected node, a move relocates it. Selection held inside the shell would
have to be updated in step with every op, which is two things changing together.
Held outside, it can be DERIVED from the post-op document — "does this id still
resolve?" — which cannot go out of step because there is only one thing to read.

Content arrives as slots, so a layers panel, an inserter and an inspector can be
built without this component changing. It knows the SHAPE of the editor and
never what fills it.

**Chrome preferences go through a port, not `localStorage`.** `store` takes
`{ read, write }`; the default reads `localStorage` in a browser and remembers
nothing anywhere else, so a server render is a default rather than a crash. A
host that already keeps user preferences server-side supplies its own and the
shell needs no change.

Preferences are restored AFTER mount, deliberately. Reading them in the state
initializer makes the server emit the defaults and the first client render emit
the restored layout, which React treats as a hydration failure and repairs by
discarding the subtree.

**Below 1280px the shell does not compress.** It says where to edit instead and
keeps the exit reachable. An editor that merely gets cramped is worse than one
that states its requirement, because the author otherwise discovers the limit by
failing at a task.

**Widths are solved by `react-resizable-panels`, not here.** The bounds are
declared — `PANEL_BOUNDS`, `MIN_CANVAS_WIDTH`, `RAIL_WIDTH` — and handed to it.
The canvas floor is expressed as the canvas panel's own minimum, which is what
makes it a joint constraint: at 1280px both panels at their individual maximums
would leave the canvas narrower than either of them, with no per-panel bound
violated, because the constraint was never per-panel.

The persisted layout is PROPORTIONAL. A pixel layout is wrong on the next
monitor; the pixel bounds still hold because the library re-applies them to
whatever the proportions resolve to.

### Where the client boundary is

**The root entry is server-safe.** `"use client"` is carried by
`@nextlyhq/builder/shell` alone, which is the only entry containing React:

```ts
// Client. The shell is a client component.
import { BuilderShell } from "@nextlyhq/builder/shell";

// Server-callable. No React in any of them.
import { BUILDER_PACKAGE_NAME, rectToHost } from "@nextlyhq/builder";
import { fitsFullShell, PANEL_BOUNDS } from "@nextlyhq/builder/shell-state";
import { rectToHost } from "@nextlyhq/builder/geometry";
```

The split is not tidiness. A banner applies to a whole artifact and everything
it re-exports, so putting the shell in the root barrel turned the frame geometry
— plain arithmetic, and public here before the shell existed — into client
references a Server Component could no longer call, while the export map went on
advertising callable functions.

`BuilderShellProps` is still described by the root entry: a type is erased, so
it carries no boundary with it.

This is the same split, for the same reason, as `@nextlyhq/ui`'s `./color` and
`./utils`. It is not hypothetical tidiness: the geometry already had a consumer
that only worked because it resolved this package through a tsconfig path
mapping to source, bypassing the published entry — so the export map was
advertising something the artifact could not deliver.

### Frame geometry

The canvas renders inside an iframe while the editor's chrome — insertion
indicator, selection outlines, drag affordances — is drawn in the host document
above it. Every one of those asks the same question: where is this canvas
rectangle, in host coordinates? It is answered here and nowhere else, because
two modules computing it separately agree on the day they are written and drift
the first time anything changes.

`FrameGeometry` — how the frame sits in the host: an `origin` and a `scale`.
The origin is where the frame's CONTENT viewport lands, not its border box.
Scroll inside the frame is deliberately not a field: a rectangle read from
inside is already relative to the frame's viewport, so subtracting its scroll
would count it twice.

`frameInsetOf(iframe)` — measure the inset. Border AND padding, because an
iframe's nested viewport begins at the CONTENT box: `clientLeft`/`clientTop`
report only the border, and a padded frame displaces the viewport further.
Provided as a function rather than as a recipe because the recipe was
documented and three call sites still got it wrong.

`frameContentOrigin(borderBox, inset, scale)` — build the origin from that
inset and the frame's measured box. `getBoundingClientRect` gives the BORDER
box while the inset is in the frame's own untransformed pixels, so the inset
has to be scaled before it is added. Getting that wrong misplaces every overlay
by `(1 - scale) * inset`, which is zero at 100% and therefore invisible in the
state a canvas is developed in.

`pointToHost` / `pointToCanvas` — a point across the frame, in either
direction. Exact inverses rather than two mappings written to match, because
hit-testing a pointer and drawing an overlay use opposite directions of the
same question.

`rectToHost` — a rectangle across the frame, size scaled with it. An overlay
sized from the unscaled rectangle is correct at 100% and wrong everywhere else.

`FrameGeometryError` — thrown when a frame describes no mapping: a zero,
negative or non-finite scale, or a non-finite origin. Thrown rather than
defaulted, because every value that could stand in is wrong in a way that looks
right, and an overlay silently drawn in the wrong place is the failure this
module exists to prevent.

The functions take plain numbers rather than DOM nodes, so the mapping can be
exercised without a browser and the DOM reads stay at the edge. The e2e
acceptance suite adapts these rather than restating them: a browser harness
carrying its own copy certifies its own copy, and would keep passing through
exactly the correction it exists to catch.

### The op store

`applyOp(document, op, limits?)` — apply one edit to a `BlockDocument`,
returning the new document under `AppliedOp.document` and the op that undoes it.
Every change goes through it: the canvas, the layers panel, the inspector and an
agent all produce ops and nothing else, which is what makes undo, autosave,
crash restore and edit review one mechanism rather than four.

It takes a DOCUMENT rather than a bare forest because the size caps are
document-level. A forest measured on its own omits `settings` and `assets`, so a
document already near its byte limit through those would accept an edit the
engine then refuses to store. The document is returned whole: `settings`,
`assets` and any field the format gains later survive an edit untouched.

`limits` defaults to the engine's `DEFAULT_LIMITS` and takes the same
`DocumentLimits` that `validate()` accepts. Pass the site's own limits if it
renders with custom ones, or the op layer and the validator will disagree about
what fits.

`BuilderOp` — the whole edit vocabulary: `insert`, `remove`, `move`, `update`.
Ops address nodes by id, never by path, because a path describes the tree at the
moment it was written and any edit above it invalidates one.

`OpError` — thrown when an op cannot apply. A refusal rather than a silent
no-op: the caller is a history, so an op that quietly did nothing would still be
recorded and its inverse would undo an edit that never happened.

`AppliedOp`, `NodePatch` — the result shape and the fields an `update` may
carry. `NodePatch` is read off the engine's own signature rather than restated.

## Development

Dependencies must be built first. This package resolves
`@nextlyhq/blocks-engine` through its published entry, which is `dist/`, so on a
clean checkout **`test`, `check-types` and `lint` all fail** until it exists —
`test` in the way worth knowing about, reporting a resolution error and a
reduced test count rather than an obvious stop.

```bash
# Once, and again after changing a dependency. Builds only what this
# package depends on, not the whole repository.
pnpm --filter @nextlyhq/builder... build
```

Then, from this directory (`packages/builder`) rather than the repository root —
turbo swallows the summary line at the root:

```bash
pnpm run test          # vitest, including the layering guard
pnpm run check-types   # tsc --noEmit; unlike some packages here, this DOES
                       # cover the test files (tsconfig has no test exclude)
pnpm run lint          # eslint --max-warnings 0; a single warning fails
pnpm run build         # tsup; this package ONLY, so its dependencies must
                       # already be built — see below
```

`pnpm turbo test --filter=@nextlyhq/builder` builds dependencies itself, because
the `test` task declares `dependsOn: ["^build"]`. `check-types` and `lint` do
not. Neither is build-free on a clean checkout: a workspace import resolves
through the sibling's package exports to a `dist` that does not exist yet, and
`lint` fails on the same specifiers through `import-x/no-unresolved`.

Build the dependencies first, and on a clean checkout that means:

```bash
pnpm --filter @nextlyhq/builder... build   # trailing ... INCLUDES this package
```

The package-local `pnpm run build` above builds this package alone, so it is
enough only once the dependencies are built. Not `@nextlyhq/builder^...` either:
`pnpm recursive --help` defines that form as the dependencies _without_ the
matched package, which leaves this package's own `dist` absent — the same
missing build wearing a different error message.

## Peer dependencies

`lucide-react` for the rail's icons, declared as a peer for the reason
`@nextlyhq/ui` declares it as one: an icon set resolved once by the host rather
than bundled per package.

React 19, matching the renderer it draws with. `@nextlyhq/blocks-react` requires
`react: ^19.0.0`, and it is a dependency here rather than a peer, so a React 18
host would hit an unsatisfiable peer one level down.

## Install

```bash
pnpm add @nextlyhq/builder
```

You are unlikely to install this directly. It arrives with
[`@nextlyhq/plugin-page-builder`](../plugin-page-builder), which is what an app adds
to get a page builder.

## Related packages

- [`@nextlyhq/plugin-page-builder`](../plugin-page-builder) — the plugin that mounts this editor
- [`@nextlyhq/blocks-engine`](../blocks-engine) — the document model every edit produces
- [`@nextlyhq/blocks-react`](../blocks-react) — the renderer the canvas draws through

## License

[MIT](../../LICENSE.md)
