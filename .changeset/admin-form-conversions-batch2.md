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

fix(admin): put seven more admin form pages on the shared layout

The API key, role, settings, webhook and user-field forms now consume
`FormLayout`, `FormActions`, `FieldShell` and `Grid` from `@nextlyhq/ui`
instead of hand-rolled page padding, a fixed action row, `SettingsRow`'s
horizontal label-left/control-right grid, and viewport-breakpoint grids.

Converted: `CreateApiKeyForm`, `EditApiKeyForm`, `RoleForm` (with
`RoleBasicInfo`), `ImageSizeForm`, `EmailProviderForm` (with
`ProviderConfigFields`), the general settings page, `WebhookForm`,
`UserFieldForm`, and the Full Name/Email/Password fields in
`UserFormFields`. Every compound `Select` field among them (API key Token
Duration/Type/Role, Image Size Resize Mode/Format, general settings
Timezone/Date Format/Time Format, and each provider config field's `select`
kind) now wires its `SelectTrigger` through `FieldShell`'s render-function
`children`, the same pattern the form builder's conversion established.

Composite controls with no single focusable element to attach an id to are
named as GROUPS instead, via `SettingsRowGroup`: `ProviderTypePicker`, the
webhook event-type checkbox group and the webhook custom-headers row each get
`role="group"` with `aria-labelledby` rather than a `<label for>` aimed at a
control that never carries the id. Measured in a browser before and after: all
three pointed at nothing in both light and dark themes.

Left hand-rolled, each with its own comment: `FieldTypePicker` and the
sign-in-method `RadioGroup`; horizontal label-left/switch-right settings rows
(`UserFieldForm`'s "Allow multiple selections", "Required" and "Active");
read-only value rows with no control at all (`EditApiKeyForm`'s Key
Properties); and one page grid needing an asymmetric row/column gap `Grid`'s
`gap` prop cannot express (`UserFormFields`'s two-column split).

`RoleBasicInfo.test.tsx` — failing on `main` before this change, asserting
placeholders, descriptions and a system-role message the component has never
rendered — is repaired to match what the component actually renders.
