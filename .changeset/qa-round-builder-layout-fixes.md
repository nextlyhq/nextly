---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/builder": patch
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
"nextly": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-mcp": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/ui": patch
---

QA round: builder layout and editor fixes.

The schema builder's Advanced tab offered the Localized switch on component
references, where it could only save a flag storage cannot honour — the
reference holds no value of its own, so toggling it read as Apply being
broken. The switch is now disabled there and names where component
localization actually lives: the fields inside the component.

The builder pages render standalone, and the breadcrumb above the entity
name was plain text — on a phone there was no way back to the list after
saving. It is now a link home. The field editor sheet no longer pushes its
left edge off narrow screens, select popups clamp to a scrollable height
even where the positioning variable is absent, the list-view card title and
value cells can shrink so long text truncates inside the card instead of
painting over it, and plugin route URLs wrap within their card instead of
overflowing past it.
