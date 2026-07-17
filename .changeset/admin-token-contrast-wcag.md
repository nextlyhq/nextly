---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"nextly": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/ui": patch
---

Admin colors now meet WCAG 2 AA contrast in both light and dark mode.

Many admin colors sat below the accessibility minimums. Borders and input outlines were nearly invisible against their surface (as low as 1.2:1, where 3:1 is required); status text (destructive, success, warning) and the status badges and alerts fell short of the 4.5:1 needed for text; popovers were too light for their own borders and inputs; and dozens of faint alpha-opacity utilities (like `text-primary/50` and `border-primary/10`) rendered unreadable text and near-invisible boundaries.

What changed:

- Borders, input outlines, and the popover surface are retuned so every boundary clears 3:1. The most visible effect is that hairline borders become distinct medium-contrast lines.
- Status colors are split into two roles, the industry-standard pattern: the base token (`--nx-destructive`, `--nx-success`, `--nx-warning`) is now the readable text color, and a new `-solid` token is the button fill under white on-color text. This lets both the colored text on a page and the white text on a solid button pass AA, which a single value cannot do in dark mode.
- The status badge and alert shades, and the warning palette, are retuned so their tinted text passes AA.
- Faint alpha-opacity utilities that rendered real text or boundaries were replaced across the admin and plugins with their proper semantic tokens; intentionally decorative uses (watermarks, ghost buttons, chart ticks) are left as-is.

Two checks run with the test suite to keep this from regressing: one asserts every rendered token and color-mix shade pair meets its WCAG minimum in both modes, and one scans the source for faint alpha-opacity color utilities.
