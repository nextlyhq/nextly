# @nextlyhq/eslint-plugin

ESLint rules that keep admin UI on Nextly's design-token system.

<p align="center">
  <a href="https://www.npmjs.com/package/@nextlyhq/eslint-plugin"><img alt="npm" src="https://img.shields.io/npm/v/@nextlyhq%2Feslint-plugin?style=flat-square&label=npm&color=cb3837" /></a>
  <a href="https://github.com/nextlyhq/nextly/blob/main/LICENSE.md"><img alt="License" src="https://img.shields.io/github/license/nextlyhq/nextly?style=flat-square&color=blue" /></a>
  <a href="https://nextlyhq.com/docs"><img alt="Status" src="https://img.shields.io/badge/status-alpha-orange?style=flat-square" /></a>
</p>

> [!IMPORTANT]
> Nextly is in alpha. APIs may change before 1.0. Pin exact versions in production.

Nextly's admin is themeable: colours, spacing and radius come from tokens, and
every surface that consumes them follows a retheme and flips between light and
dark for free. A surface that reaches past the tokens does not. These rules catch
the three ways that happens.

They apply to **any** Nextly plugin, not just the first-party ones — which is why
they ship as a package rather than living in Nextly's own repository.

## Install

```sh
npm install --save-dev @nextlyhq/eslint-plugin
```

Requires ESLint 9 or later (flat config).

## Use

```js
// eslint.config.mjs
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import nextly from "@nextlyhq/eslint-plugin";

export default tseslint.config(
  { ignores: ["dist", "node_modules"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...nextly.configs.recommended
);
```

Rules can also be enabled one at a time:

```js
export default [
  {
    plugins: { "@nextlyhq": nextly },
    rules: { "@nextlyhq/no-palette-classes": "error" },
  },
];
```

## Rules

### `no-palette-classes`

A Tailwind palette hue is a fixed colour. It does not move when the theme moves,
so a surface painted with one keeps its light-mode appearance in dark mode while
everything around it changes.

```jsx
// ✗ frozen at the value you typed
<div className="bg-red-500 text-slate-400" />

// ✓ derives from a token, so a retheme moves it
<div className="bg-destructive text-muted-foreground" />
```

The error names the scale to use instead: `success-*`, `warning-*`,
`destructive-*`, `primary-*`, or a neutral (`foreground`, `muted-foreground`,
`border`).

### `no-hardcoded-colors`

The same problem in a literal rather than a class.

```jsx
// ✗
<div style={{ borderColor: "#e5e7eb" }} />;
const shadow = "0 1px 2px rgb(12 34 56 / 0.1)";

// ✓
<div className="border-border" />;
const shadow =
  "0 1px 2px color-mix(in oklch, var(--nx-foreground) 10%, transparent)";
```

It also catches CSS **named** colours, which are the easiest to miss because
they read as ordinary words:

```jsx
// ✗ ignores the theme completely
<div style={{ backgroundColor: "deepskyblue" }} />;
const css = ".badge { color: crimson }";

// ✓
<div className="bg-primary" />;
```

A colour name is only reported where its POSITION makes it a colour — the value
of a colour-valued property, or the right-hand side of a CSS declaration. Prose
and data are untouched, so `"the red team"`, `{ fruit: "plum" }` and a label
reading `"Tomato"` are all fine.

Black, white and transparent are exempt: they are mode-invariant, so routing
them through a themed token would claim a variation that does not exist. So are
`url(...)` payloads and `placeholder` example values.

### `no-static-inline-style`

An inline style whose every value is a constant is a utility class written the
long way — it bypasses the spacing and radius scales and does not respond to the
theme.

```jsx
// ✗ every value is constant, so a class could have expressed it
<div style={{ padding: 24, display: "flex" }} />

// ✓
<div className="flex p-6" />

// ✓ computed at run time — a class cannot express this, and the rule ignores it
<div style={{ transform: `translateX(${offset}px)` }} />
```

The rule only reports the all-constant case, so the legitimate use of inline
style — a value you compute — needs no exemption and no allowlist.

## Exemptions

A genuine exception is marked in place, with a reason, on the line itself or the
line above:

```jsx
// design-lint-ok: matches the external brand swatch this embed must sit inside
<div className="bg-red-500" />
```

A marked line states what was decided and survives review. Disabling a rule for a
file or a directory silently exempts everything added to it later, which is why
the marker is per-line.

## Where the tokens are documented

The full token contract — what each token means, the two CSS entry points, and
how plugin styles inherit the admin's light/dark scope — is in the
[plugin UI authoring guide](https://nextlyhq.com/docs/plugins).

## Related packages

- [`@nextlyhq/ui`](../ui) — the components these rules keep on-token
- [`@nextlyhq/admin-css`](../admin-css) — scopes and compiles the admin stylesheet
- [`@nextlyhq/admin`](../admin) — the admin these tokens theme

## License

[MIT](../../LICENSE.md)
