---
"@nextlyhq/ui": patch
---

`@nextlyhq/ui` now ships its own design-system CSS, making it self-contained. Two new entry points are exported:

- `@nextlyhq/ui/styles.css` — a pre-compiled, minified bundle (Tailwind + tokens + this package's component utilities). Import it once and the components render styled, token-driven, and dark-mode-aware with no Tailwind setup required.
- `@nextlyhq/ui/theme.css` — the raw design-system source (token definitions on `:root`/`.dark`, the `@theme inline` mappings, the `dark` variant, and the base reset) for consumers that compile Tailwind themselves and want to build against the token contract.

Previously the package shipped JS only and its components inherited tokens from the host app, so importing them outside the admin produced unstyled output.
