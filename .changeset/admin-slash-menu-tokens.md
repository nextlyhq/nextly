---
"@nextlyhq/admin": patch
---

Fix the rich-text slash-command menu in dark mode. Its inline styles used hardcoded white/slate hex values, so it rendered as a white panel with dark text on dark backgrounds; it now uses the popover/muted design tokens and adapts to the theme.
