---
"@revnixhq/admin": minor
"@revnixhq/ui": minor
---

Introduce shared `SettingsSection`, `SettingsRow`, and `SettingsTableToolbar` components for consistent settings-page layouts. Adjust field border and focus styles globally so inputs are clearly visible (`border-input` instead of the near-invisible `border-primary/5`) and the focus state is just a border-color change (no outer ring or glow). Bumps the `--input` HSL token to `zinc-300` in light mode and `zinc-700` in dark mode.
