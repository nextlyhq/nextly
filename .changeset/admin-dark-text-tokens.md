---
"@nextlyhq/ui": patch
"@nextlyhq/admin": patch
---

Fix dark-mode text and header colors by replacing hardcoded colors with design tokens. Text that used fixed slate/gray/black shades now uses `text-foreground` / `text-muted-foreground`, and entry/builder header bars use `bg-background` instead of a hardcoded white background, so column values, titles, and toolbars are legible in dark mode instead of rendering black-on-dark or white-on-dark.
