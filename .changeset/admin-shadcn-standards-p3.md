---
"@nextlyhq/admin": patch
---

Align the admin with current shadcn/Tailwind v4 conventions (P3). The border-radius scale is now derived from the single `--radius` knob via `calc()`, a scoped `@layer base` reset makes a bare `border` utility default to the theme border token, and `components.json` uses the `new-york` style. No visual change to the monochrome design.
