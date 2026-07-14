---
"@nextlyhq/admin": patch
---

The admin now sources its design tokens, `@theme` mappings, and dark variant from `@nextlyhq/ui/theme.css` instead of defining them inline, so the design system has a single home. The compiled admin stylesheet is unchanged (tokens remain scoped to `.adminapp`, with no leakage to the host document) — this is an internal consolidation with no visual change.
