---
"@nextlyhq/ui": patch
"@nextlyhq/admin": patch
---

Complete the dark-mode surface migration to design tokens. Hardcoded surface backgrounds now use tokens: `bg-white` → `bg-card`, light grays → `bg-muted`, hardcoded black/slate primary buttons → `bg-primary`/`text-primary-foreground`, and redundant per-element `dark:` color overrides were removed in favor of tokens that adapt automatically. Icons, buttons, badges, and panels across roles, users, media, plugins, API keys, email, and the builders now render correctly in dark mode instead of appearing black-on-dark or white-on-dark.
