---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/ui": patch
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
---

The admin's design tokens now actually drive its appearance. Setting
`--radius`, `--font-sans` or a brand colour reaches the components that
should follow it, so a themed admin looks themed instead of only partly so.
Radii across inputs, buttons, cards, badges and panels are derived from
`--radius` rather than fixed per component, and the font family tokens are read
at their use sites rather than being frozen into the compiled stylesheet.

Font weights work again. `font-bold`, `font-semibold`, `font-medium` and
`font-normal` had been compiling to nothing, so headings, buttons and emphasis
rendered at the body weight throughout the admin; they now render at their
intended weight.

Several colour bugs are fixed, mostly in dark mode: sidebar navigation labels no
longer take a tint from a themed brand colour, the sidebar has a distinct resting
and active ink step, the email template preview frame no longer paints a white
box on a dark page, and floating panels, neutral washes and the draft swatch are
tinted from tokens instead of hardcoded values.

Borders are lighter. `--nx-border` is now a decorative separator, so tables,
cards and dividers read as quiet rules rather than hard lines, while form
controls keep a clearly visible edge: text fields, search fields, selects, the
tag, code and rich-text editors, colour pickers and the date-picker trigger are
all drawn with the control-boundary token.

Radio buttons and avatars are round again, along with switches, spinners and
status dots, which a non-zero `--radius` had been squaring off.
