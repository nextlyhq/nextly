# @nextlyhq/plugin-sdk

## 0.0.2-alpha.34

### Patch Changes

- [#156](https://github.com/nextlyhq/nextly/pull/156) [`fd0aa70`](https://github.com/nextlyhq/nextly/commit/fd0aa706eb1ae4ed485e0337919b020d49181ccb) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - A comprehensive visual refresh of the Nextly admin.
  - **Consistent lists everywhere.** Every admin list — collections, entries, users, roles, media, API keys, singles, components, plugins, and form-builder submissions — now uses one unified data table with full-row navigation, and plugins can extend any list through new registries exported from the admin package.
  - **Design-token theming.** Hardcoded colors were replaced with design tokens across light and dark mode: dark-mode surfaces and text, a three-tier border scale that fixes the pervasive faint borders, clearer sidebar active states, readable link/breadcrumb contrast, and more legible badges, checkboxes, and radios. The admin is on Tailwind CSS 4.3 with the shadcn setup aligned to Tailwind v4's `@theme inline` model.
  - **Responsiveness.** The sidebar collapses to the mobile drawer across the full tablet range, wide tables keep readable columns and scroll horizontally, and the form builder's two-pane layout and tab strip adapt to narrow widths.
  - **Auth and API-key pages.** API keys open a full edit page on the shared settings layout, the registration form places one field per row, and the auth pages have corrected borders and width.
  - **Code-first schemas.** Collections, singles, and components defined in code now open in a read-only builder view instead of appearing broken.
  - **Email subsystem.** A redesigned full-width template workbench with a fixed HTML/plain-text editor-and-preview toggle; emails send as `multipart/alternative` with a plain-text alternative; every send emits a consistent log record; providers gain an Active toggle and dark-mode-legible logos; providers and templates render in the unified table; templates and layouts are unified into one kind-tagged model; and a Send test action is available while editing a template.
  - **Form builder.** The builder UI now matches the Nextly admin design system (monochrome theming), reports its version from `package.json`, and every package entry exposes a `default` export condition.

- [#158](https://github.com/nextlyhq/nextly/pull/158) [`f90fd3d`](https://github.com/nextlyhq/nextly/commit/f90fd3dd75b06e0d5818ffacfe79d0bd7db21575) Thanks [@mobeenabdullah](https://github.com/mobeenabdullah)! - The Nextly design system now lives in `@nextlyhq/ui` and is self-contained. You can style plugins and custom admin UIs two ways: import `@nextlyhq/ui/styles.css` for fully-styled, token-driven, dark-mode-aware components with zero Tailwind setup, or import `@nextlyhq/ui/theme.css` to build your own utilities against the token contract (tokens on `:root`/`.dark`, the `@theme` mappings, and the dark variant). Add the `dark` class to switch themes.

  Control heights (Button, Input, Select) are now driven by a `--control-height` token scale, so control density can be tuned from one place; default sizes are unchanged. The admin renders identically to before — it now sources its tokens from `@nextlyhq/ui` with no visual change and no token leakage into the host page.

  The form-builder and page-builder plugins now consume the design tokens directly (`var(--token)` / `color-mix`), so their admin UIs are fully token-driven and render correctly in both light and dark mode — the page-builder's canvas selection and drop indicators now follow the admin theme instead of a fixed accent. A new [plugin UI authoring guide](https://github.com/nextlyhq/nextly/blob/main/packages/ui/docs/plugin-ui-authoring.md) documents the token contract, and a `lint:design` check (wired into CI) keeps admin and plugin styles token-driven.

  The theme switcher (light / dark / system) now lives in the admin top bar for one-click access and applies instantly, instead of being tucked inside Settings behind a save.

- [#157](https://github.com/nextlyhq/nextly/pull/157) [`2b725ea`](https://github.com/nextlyhq/nextly/commit/2b725eab34613b4b49be6975ad2fb3add81ee29d) Thanks [@aqib-rx](https://github.com/aqib-rx)! - Expand the page builder toward Elementor/Gutenberg parity: a much larger block set, deep per-block options, entrance motion, global design tokens, and platform helpers — all built on the plugin's existing extension seams with no Nextly-core changes.
  - **`supports` capability model.** A block declares which style capabilities it exposes (`supports: { typography, color, background, border, shadow, dimensions, position, opacity, filters, motion, visibility, interactions, customCss, customAttributes }`) and the inspector's Style/Advanced controls plus the compiled CSS are derived from that single declaration. `styleControls` remains as an escape hatch.
  - **Expanded styling.** The typed `StyleValues` now covers full typography (family/weight/appearance/letter-case/decoration/line-height/letter- & word-spacing), structured borders, box-shadow (with presets), background image + linear gradient, sizing (min-height/object-fit/overflow/aspect-ratio), opacity, CSS filters, transforms, absolute/fixed/sticky position + z-index, Gutenberg-style width alignment (wide/full), and descendant link colors (default/hover). All values pass css-tree validation before emission.
  - **Per-block custom CSS + attributes.** Authors can write per-block CSS using the Elementor-style `selector` keyword (sanitized and scoped at render), set a CSS ID and custom HTML attributes (allowlisted), and hide a block per breakpoint. New composite inspector controls: border, background, gradient, position, slider, box-shadow, unit-aware dimension, repeater, and icon picker; the typography selects now carry real option lists.
  - **~40 new/upgraded blocks.** Structure (Columns, Spacer, Divider, Anchor, Row/Stack); Basic (List, Icon List, Badge, Icon, Button Group, Rich Text, Table, Social Icons, Progress Bar, Counter, Rating, Countdown) plus inline formatting (bold/italic/link/highlight/strikethrough/sub/superscript) on Paragraph/Heading/List; Media (Cover, Gallery, Image/Logo Carousel, Slides, Content Carousel, Hotspot, Lottie) plus Image (caption/link/aspect/rounded) and Video (self-hosted, autoplay/mute/loop/controls, privacy host, poster) upgrades; Content cards (Icon Box, Image Box, CTA Card, Flip Box, Pricing Table, Price List, Form, Testimonial + Carousel, Reviews, Logo Cloud); Interactive (Tabs, Accordion, Toggle, Off Canvas — all server-rendered with no client JS via CSS scroll-snap / native `<details>` / the checkbox-hack); Utility (HTML/Embed, Map, reusable `core/ref`).
  - **Entrance motion.** A `motion` option compiles fade/slide/zoom entrance animations to CSS wrapped in `prefers-reduced-motion: no-preference`, with keyframes emitted once per page.
  - **Platform helpers.** Global design tokens surfaced as inspector color swatches, cycle-guarded reusable blocks (`core/ref`), template composition (`composeTemplate`), revision snapshot/prune helpers, and editor copy/paste + copy-style/paste-style with a navigator flatten utility.
  - **Packaging fix.** `sideEffects` now covers the source admin and block-registration entries so the plugin's components and blocks register from a plain side-effect import even under source-mode/monorepo bundling (previously tree-shaken, leaving the editor empty).

  All additions are additive and optional, so existing pages need no migration.

- Updated dependencies [[`bc714c2`](https://github.com/nextlyhq/nextly/commit/bc714c293a167f3ddcb10a11dbf738876f55c84b), [`d9a2da5`](https://github.com/nextlyhq/nextly/commit/d9a2da5923cf512d5a201d96af915306c188e6b0), [`3e67673`](https://github.com/nextlyhq/nextly/commit/3e676739b53f47f6a837c08faef654fdf76cdd1b), [`fd0aa70`](https://github.com/nextlyhq/nextly/commit/fd0aa706eb1ae4ed485e0337919b020d49181ccb), [`f90fd3d`](https://github.com/nextlyhq/nextly/commit/f90fd3dd75b06e0d5818ffacfe79d0bd7db21575), [`2b725ea`](https://github.com/nextlyhq/nextly/commit/2b725eab34613b4b49be6975ad2fb3add81ee29d)]:
  - @nextlyhq/admin@0.0.2-alpha.34
  - nextly@0.0.2-alpha.34

## 0.0.2-alpha.33

### Patch Changes

- [#154](https://github.com/nextlyhq/nextly/pull/154) [`17a5e16`](https://github.com/nextlyhq/nextly/commit/17a5e164e8679d95d401d88097a913e599d0bbcf) Thanks [@aqib-rx](https://github.com/aqib-rx)! - Add editable page-level custom CSS with live preview in the page builder editor

- Updated dependencies [[`17a5e16`](https://github.com/nextlyhq/nextly/commit/17a5e164e8679d95d401d88097a913e599d0bbcf)]:
  - @nextlyhq/admin@0.0.2-alpha.33
  - nextly@0.0.2-alpha.33

## 0.0.2-alpha.32

### Patch Changes

- Fix installation of the plugin in fresh apps: internal `@nextlyhq/*` peer dependencies now use the `workspace:*` protocol, so each published version's peers are rewritten to the versions released alongside it instead of a hard-coded (and stale) pin. Previously `npm install @nextlyhq/plugin-page-builder` / `nextly add` failed with `ERESOLVE` because the published peers demanded an older core version than the one installed.

- Updated dependencies []:
  - @nextlyhq/admin@0.0.2-alpha.32
  - nextly@0.0.2-alpha.32

## 0.0.2-alpha.31

### Patch Changes

- [#150](https://github.com/nextlyhq/nextly/pull/150) [`91d9d03`](https://github.com/nextlyhq/nextly/commit/91d9d03b55b1a54c2549d9c8f6ad2de8ff187a05) Thanks [@aqib-rx](https://github.com/aqib-rx)! - Per-entry editor choice + the generic, plugin-agnostic platform hooks that power it. A collection or single can offer a per-entry **Default / Page Builder** toggle, and turning it on shows a visual canvas instead of the normal fields — delivered entirely through reusable extension points, with no page-builder-specific code in core or admin.
  - **Plugin field types round-trip to production.** `ui-schema.json` (the committable schema manifest) now accepts plugin-contributed field types, and the CLI registers `contributes.fieldTypes` before generating migrations — so a plugin field type resolves to its declared storage column and survives to production. Previously a UI-created plugin field was downgraded to `json` in the manifest, so the real type was lost outside dev.
  - **`layout: "takeover"` field-type flag.** A plugin field type can declare that, when a field of that type is active, the entry/single form collapses to just that field plus the field that controls its `admin.condition` — hiding the rest. Generic: it keys off field-type metadata (`branding.plugins[].fieldTypes[].layout`) and the existing condition evaluator, so any plugin field type can opt in.
  - **`contributes.admin.schemaBuilderSlot`.** Plugins can render a control above the field list in the collection/single schema builders, receiving `{ fields, setFields, disabled, context }` to add builder-time behavior (e.g. an editor-choice toggle) without core knowing the plugin.
  - **`contributes.admin.entryFormToolbarSlot`.** Plugins can render a control in the entry/single form header toolbar, reading and writing form state via react-hook-form — for form-level controls like a mode toggle.
  - **Managed (hidden) fields.** A field marked `admin.hidden` is kept out of the schema-builder "Your fields" list and out of the entry-form body while its value still lives in the form state — used for plugin plumbing that's driven by a toolbar control rather than shown as a field.

  `@nextlyhq/plugin-page-builder` is the first consumer of all of the above and is published through the same release: it registers a `page-builder` field type with `layout: "takeover"`, contributes the "Use Page Builder" schema-builder toggle and the per-entry Default / Page Builder form-toolbar toggle, ships the visual block editor (drag-and-drop canvas, inspector, responsive preview, query loop), and works for both code-first (`withPageBuilder()`) and UI-created collections and singles. Packaging: declares `sideEffects` so its admin components register from a plain side-effect import, with pinned peer versions for clean installs.

- Updated dependencies [[`91d9d03`](https://github.com/nextlyhq/nextly/commit/91d9d03b55b1a54c2549d9c8f6ad2de8ff187a05)]:
  - @nextlyhq/admin@0.0.2-alpha.31
  - nextly@0.0.2-alpha.31

## 0.0.2-alpha.30

### Patch Changes

- [#145](https://github.com/nextlyhq/nextly/pull/145) [`76bde2a`](https://github.com/nextlyhq/nextly/commit/76bde2a647b70203e2cd457688ec30d1d6428fc5) Thanks [@muzzamil-rx](https://github.com/muzzamil-rx)! - The API reference was not correctly specified in the `useEffect` dependency array. It was set as `[api]`, whereas it should have been `[api.public]`.

- Updated dependencies [[`76bde2a`](https://github.com/nextlyhq/nextly/commit/76bde2a647b70203e2cd457688ec30d1d6428fc5)]:
  - @nextlyhq/admin@0.0.2-alpha.30
  - nextly@0.0.2-alpha.30

## 0.0.2-alpha.29

### Patch Changes

- [#143](https://github.com/nextlyhq/nextly/pull/143) [`cac7928`](https://github.com/nextlyhq/nextly/commit/cac7928de8b9c3f8f186da29cd37f35401eca8aa) Thanks [@aqib-rx](https://github.com/aqib-rx)! - Extensible plugin platform — plugins are first-class, semver-protected extensions of a Nextly app, wired through a single `plugins` array in `defineConfig`.
  - **Plugin contract + SDK**: `definePlugin()` and the `plugins` array, with `@nextlyhq/plugin-sdk` as the stable, semver-protected authoring boundary (the packages stay `0.x` alpha; the SDK surface is held to the stability ladder). Boot-time dependency ordering via `dependsOn` / `optionalDependsOn`, version-range checks, and an `enabled` gate.
  - **Schema contributions**: plugins can contribute their own collections, singles, and components; `contributes.extend` adds fields to existing collections — both code-first AND UI-Builder–created ones — and cross-plugin relations resolve at boot. Plugin-owned fields carry provenance (`source`/`owner`/`locked`) and render locked + labelled in the Schema Builder so they can't be edited away.
  - **Permissions**: `contributes.permissions` registers custom permissions and role bundles that flow through the existing access-control checks.
  - **HTTP routes**: namespaced, secure-by-default plugin routes mounted under `/api/plugins/<name>/…`, with the same auth/CSRF guarantees as core routes.
  - **Admin UI contributions**: menu items, full pages, settings panels, custom views, and header/toolbar slots (show/hide defaults + inject components). Plugin admin component modules are auto-registered.
  - **Lifecycle events + filters**: an event bus plugins publish to and subscribe from, plus context filters they can transform — the basis for cache invalidation, side effects, and cross-plugin reactions.
  - **Custom field types, email providers/templates, and auth extensibility** (strategies + hooks) are all pluggable through the same contract.
  - **First-party + tooling**: ships `@nextlyhq/plugin-form-builder`, the `nextly add <package>` install-and-wire CLI command, and `create-nextly-app` plugin scaffolding.

- Updated dependencies [[`cac7928`](https://github.com/nextlyhq/nextly/commit/cac7928de8b9c3f8f186da29cd37f35401eca8aa)]:
  - @nextlyhq/admin@0.0.2-alpha.29
  - nextly@0.0.2-alpha.29
