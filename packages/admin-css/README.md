# @nextlyhq/admin-css

Build tooling to scope and compile Nextly admin CSS, shared by the admin build and by
third-party plugins.

<p align="left">
  <a href="https://www.npmjs.com/package/@nextlyhq/admin-css"><img alt="npm" src="https://img.shields.io/npm/v/@nextlyhq/admin-css?style=flat-square&label=npm&color=cb3837" /></a>
  <a href="https://github.com/nextlyhq/nextly/blob/main/LICENSE.md"><img alt="License" src="https://img.shields.io/github/license/nextlyhq/nextly?style=flat-square&color=blue" /></a>
</p>

> [!IMPORTANT]
> Nextly is in alpha. APIs may change before 1.0 — pin exact versions in production.
> See the [plugin stability ladder](https://nextlyhq.com/docs/plugins/stability) for
> which plugin surfaces are stable and which are experimental.

## What it is

The Nextly admin mounts inside your application's own document, so every CSS rule it
ships has to stay under `.nextly-admin`. A rule that escapes that wrapper restyles
your site's pages.

This package owns that scoping. It is used by two builds — the admin's own, and the
`nextly-build-admin-css` command that plugins use to compile the stylesheet they ship
as `admin.styles`. One implementation, so the two can never drift apart.

You do not import it at runtime. It runs at build time.

## Install

```bash
pnpm add -D @nextlyhq/admin-css
```

## Compiling a plugin's admin stylesheet

The common case is the CLI. Point it at your Tailwind entry file and an output path:

```bash
nextly-build-admin-css src/admin.css dist/admin.css
```

It compiles with the Tailwind CLI, scopes every rule under `.nextly-admin`, **refuses
to emit if any rule escaped the wrapper**, then minifies. The Tailwind CLI is resolved
from this package's own dependencies, so you do not need Tailwind on your `PATH`.

Wire it into your plugin's build script:

```json
{
  "scripts": {
    "build:css": "nextly-build-admin-css src/admin.css dist/admin.css"
  }
}
```

## Using the scoping functions directly

If you have your own build pipeline, the same functions are exported:

```js
import { scopeCss, checkAdminStyles } from "@nextlyhq/admin-css";

const scoped = scopeCss(compiledCss);

// Returns the problems it found; an empty array means the stylesheet is safe.
const issues = checkAdminStyles({ css: scoped });
for (const issue of issues) {
  console.error(`${issue.severity}: ${issue.message}`);
}
```

| Export                                     | What it does                                                                                                                  |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `scopeCss(css, scope?)`                    | Scopes every rule in a stylesheet under `.nextly-admin`                                                                       |
| `checkAdminStyles({ css })`                | Returns `{ severity, message }[]` for rules that escaped the wrapper, and for hardcoded colors that should be `--nx-*` tokens |
| `findUnscopedRules(css, scope?)`           | Lists the rules that escaped, for reporting                                                                                   |
| `scopeSelector(selector, scope?)`          | Scopes one selector                                                                                                           |
| `isScoped(selector, scope?)`               | Whether one selector is already scoped                                                                                        |
| `splitTopLevel(selector)`                  | Splits a selector list on top-level commas                                                                                    |
| `confineVariantClasses(css, scope?)`       | Keeps Tailwind variant classes inside the scope                                                                               |
| `namespaceInternalProperties(css, prefix)` | Namespaces internal custom properties                                                                                         |
| `prefixKeyframes(css, prefix)`             | Prefixes `@keyframes` names so they cannot collide                                                                            |

## Related packages

- [`@nextlyhq/admin`](../admin) — the admin dashboard these styles belong to
- [`@nextlyhq/plugin-sdk`](../plugin-sdk) — building a plugin that contributes admin UI
- [`@nextlyhq/eslint-plugin`](../eslint-plugin) — keeps admin UI on the design-token system

## Documentation

- [Plugin admin UI](https://nextlyhq.com/docs/plugins/admin-ui)
- [Admin customization](https://nextlyhq.com/docs/admin/customization)

## License

[MIT](../../LICENSE.md)
