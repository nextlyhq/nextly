# Plugin UI authoring guide

How to build admin UI — plugin views, custom fields, dashboards — that looks native
to the Nextly admin and inherits light/dark mode for free.

The rules here are a **contract**. A lint guard (`pnpm lint:design`, run in CI) fails the
build on the most common violations, so following this guide is not optional for code that
ships in this repo.

---

## 1. Where your styles come from

Nextly's design system lives in [`@nextlyhq/ui`](../README.md). It ships two CSS entry
points:

| Entry point               | Contents                                                                  | Use when                                                |
| ------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------- |
| `@nextlyhq/ui/theme.css`  | Design tokens + `@theme` mappings + `@keyframes`. No reset, no `@import`. | You run your own Tailwind v4 build and want the tokens. |
| `@nextlyhq/ui/styles.css` | Pre-compiled bundle (Tailwind + tokens + reset). Zero config.             | Standalone UI, or a quick embed with no build wiring.   |

**Inside a Nextly admin plugin you usually need neither.** The admin already loads
`@nextlyhq/admin/style.css`, which defines every token scoped to `.adminapp` (and
`.adminapp.dark` for dark mode). Plugin admin views render inside that scope, so the tokens
are already on the page. Your plugin CSS should **consume** those tokens, never redefine
them.

Only import a stylesheet yourself when you render outside the admin shell (e.g. a public
page or a standalone tool) — then import `@nextlyhq/ui/styles.css` once at the root.

---

## 2. The token contract

Tokens are **complete color values** (OKLCH). Reference them directly:

```css
.my-panel {
  background: var(--card);
  color: var(--foreground);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}
```

### Never wrap a token in `hsl()` / `rgb()`

Older Nextly builds stored tokens as bare HSL channels (`--primary: 221 83% 53%`) and code
wrapped them: `hsl(var(--primary))`. **That convention is gone.** Tokens are now full colors
(`--primary: oklch(0 0 0)`), so `hsl(var(--primary))` becomes `hsl(oklch(0 0 0))`, which is
invalid CSS — the browser drops the declaration and your element loses its color. Always:

```css
/* ✗ wrong — produces hsl(oklch(...)), silently dropped */
color: hsl(var(--foreground));

/* ✓ right */
color: var(--foreground);
```

### Alpha / transparency

You can no longer do `hsl(var(--primary) / 0.1)`. Use `color-mix`:

```css
/* 10% primary over transparent */
background: color-mix(in srgb, var(--primary) 10%, transparent);

/* a subtle hover tint from the foreground */
background: color-mix(in srgb, var(--foreground) 6%, transparent);
```

### The tokens you may use

Colors: `--background` / `--foreground`, `--card` / `--card-foreground`,
`--popover` / `--popover-foreground`, `--primary` / `--primary-foreground`,
`--secondary` / `--secondary-foreground`, `--muted` / `--muted-foreground`,
`--accent` / `--accent-foreground`, `--destructive`, `--success`, `--warning`,
`--border`, `--border-strong`, `--input`, `--ring`,
`--sidebar-background` and the `--sidebar-*` family.

Sizing: `--radius` (the system is square — this is `0`; always route corner radius through
it so a future rounding is one edit), and the control-height scale `--control-height`,
`--control-height-sm`, `--control-height-md`, `--control-height-lg` for anything that should
line up with admin inputs and buttons.

Do not hardcode hex, `rgb()`, `rgba()`, or named colors. The only literals allowed are
`transparent`, `currentColor`, and `inherit`.

---

## 3. Prefer components and utilities over hand-rolled CSS

For new UI, reach for `@nextlyhq/ui` components and Tailwind utility classes before writing
a stylesheet. They are already token-driven, accessible, and dark-mode-correct.

```tsx
import { Button, Input, Select, Switch, Badge } from "@nextlyhq/ui";
import { cn } from "@nextlyhq/ui";

<Button variant="outline" size="sm">Add field</Button>
<Input placeholder="Form name" />
```

- Merge conditional classes with `cn()` (clsx + tailwind-merge).
- Express variants with `cva` (class-variance-authority), the way the components do.
- Target internal parts with the `data-slot` attribute, not by re-styling the component.

Hand-written CSS is still fine for bespoke layouts (a drag-and-drop canvas, a box-model
control). When you write it, it must obey the token contract in section 2 and be scoped
(section 5).

---

## 4. Dark mode is automatic — don't fight it

The admin flips every token under `.adminapp.dark`. If you only ever reference tokens, your
UI switches with it and you never write a dark rule.

- **Never** hardcode a light or dark color.
- **Never** gate admin theming on `@media (prefers-color-scheme: dark)` — admin dark mode is
  class-based (`.dark` / `.adminapp.dark`), independent of the OS. A media query makes your
  UI ignore the admin's own theme toggle. Use Tailwind's `dark:` variant or `.adminapp.dark`
  descendant selectors if you truly need a mode-specific tweak.

---

## 5. Scope your class names

Plugin CSS shares the page with the admin. Prefix every class so nothing leaks:
`nx-pb-*` (page builder), `field-editor-*` / `form-settings-*` (form builder), etc. Never
style bare element selectors (`button {}`, `input {}`) or admin utility classes.

---

## 6. Responsive: containers, not the viewport

Plugin panels live in variable-width columns, so a media query keyed to the viewport is the
wrong tool — it fires on window size while your panel might be half that. Use CSS container
queries (Tailwind v4 core) against the nearest sized ancestor:

```tsx
<div className="@container/panel">
  <div className="grid grid-cols-1 @2xl/panel:grid-cols-2">...</div>
</div>
```

Container breakpoints are **container-sized**, not viewport-sized: `@md` = a 448px container,
`@2xl` = 672px, `@4xl` = 896px. Pick the threshold by testing the panel, not by mapping from
`md:`/`lg:`.

---

## 7. The guardrail

`pnpm lint:design` (run in CI) scans the admin and plugin packages and fails on:

- `hsl(var(--…))` / `rgb(var(--…))` — the dead HSL-channel convention (section 2).
- Hardcoded colors: hex, `rgb(`, `rgba(`, `hsl(` with literal channels (outside `url(...)`
  data URIs). Allowed literals: `transparent`, `currentColor`, `inherit`.
- `!important` outside the small, reviewed allowlist.

Run it locally before pushing. If a finding is a genuine false positive, add it to the
allowlist in the script with a one-line reason — don't silence the whole check.

---

## Checklist

- [ ] Colors come from `var(--token)` — no `hsl()`/`rgb()` wrappers, no hardcoded values.
- [ ] Alpha uses `color-mix(in srgb, var(--token) N%, transparent)`.
- [ ] Corner radius routes through `var(--radius)`; control heights use `--control-height*`.
- [ ] New UI uses `@nextlyhq/ui` components + Tailwind utilities where practical.
- [ ] No `@media (prefers-color-scheme)`; dark mode inherited from the admin.
- [ ] Class names are prefixed/scoped; no bare element selectors.
- [ ] Responsive rules use container queries, tested against the panel width.
- [ ] `pnpm lint:design` passes.
- [ ] Verified in the admin in **both** light and dark mode.
