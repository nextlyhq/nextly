---
"@nextlyhq/admin": patch
---

Modernize the admin design tokens to full-color values (P1 of the design-system modernization). Token values are now complete colors (`hsl(0 0% 100%)`) mapped through `@theme inline` with bare `var()`, removing ~250 `hsl(var(--…))` wrappers across the stylesheet and components; alpha modifiers become `color-mix`. This is a structural change with no visual difference and sets up the OKLCH conversion.
