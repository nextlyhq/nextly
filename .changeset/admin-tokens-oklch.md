---
"@nextlyhq/admin": patch
---

Convert the admin design tokens to OKLCH (P2 of the design-system modernization), matching shadcn's current default color format. All 77 token values were precisely converted from HSL to `oklch(...)` (sRGB-identical, verified pixel-identical in light and dark). No visual change; the palette is now perceptually uniform and ready for a future chromatic accent.
