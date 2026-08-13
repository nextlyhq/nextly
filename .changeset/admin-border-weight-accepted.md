---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
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
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

Take the reference palette's light-mode values for the admin, and record what
that costs where a reader will find it.

`--nx-input`, `--nx-border-strong` and `--nx-sidebar-border` move to the
reference border weight; `--nx-destructive` and `--nx-destructive-solid` move to
the reference red; `--nx-sidebar-foreground` matches the active nav ink so the
sidebar reads at body-text weight.

Several of those render below their WCAG minimum, deliberately. Each affected
pairing is listed in the new `contrast/accepted.ts` with the ratio it actually
measures, and the contrast suites hold every entry to three properties: it still
measures what is recorded, it is still below its threshold, and it still names a
token the theme declares. The sharpest is white on the destructive fill at
3.84:1, which is the label of the Delete, Discard and Unpublish confirm buttons.

Because resting and active sidebar ink are now one value in light mode, the
active row also carries a font-weight change. A fill at 1.11:1 cannot identify a
state on its own, and a weight difference is not a colour, so it is not subject
to a contrast ratio at all.

Dark mode is unchanged apart from `--nx-success`, which moves a step lighter to
clear its minimum on the muted surface with the margin the suite requires.

Checkbox and radio take a new `--nx-control-border` rather than following the
field border down. A field is identifiable without its edge; an unchecked box is
only the box, so its boundary is held to 3:1 with no acceptance.
