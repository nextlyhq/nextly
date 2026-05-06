# @revnixhq/plugin-form-builder

Drag-and-drop form builder plugin for Nextly. Build forms visually, collect submissions, and filter them by form.

<p align="center">
  <a href="https://www.npmjs.com/package/@revnixhq/plugin-form-builder"><img alt="npm" src="https://img.shields.io/npm/v/@revnixhq/plugin-form-builder?style=flat-square&label=npm&color=cb3837" /></a>
  <a href="https://github.com/nextlyhq/nextly/blob/main/LICENSE.md"><img alt="License" src="https://img.shields.io/github/license/nextlyhq/nextly?style=flat-square&color=blue" /></a>
  <a href="https://nextlyhq.com/docs"><img alt="Status" src="https://img.shields.io/badge/status-alpha-orange?style=flat-square" /></a>
</p>

> [!IMPORTANT]
> Nextly is in alpha. APIs may change before 1.0. Pin exact versions in production.

## What it is

A first-party Nextly plugin that adds a visual form builder to the admin panel and a `form-submissions` collection for capturing entries. Users design forms by dragging fields onto a canvas; submissions are stored in your database and browsable in the admin.

Install this whenever you want admin-managed forms (contact, signup, newsletter, surveys) without writing a backend.

## Installation

```bash
pnpm add @revnixhq/plugin-form-builder
```

## Quick usage

Register the default plugin in `nextly.config.ts`:

```ts
import { defineConfig } from "@revnixhq/nextly/config";
import { formBuilderPlugin } from "@revnixhq/plugin-form-builder";

export default defineConfig({
  plugins: [formBuilderPlugin],
  collections: [],
});
```

For customization (e.g. email notification defaults), use the factory directly:

```ts
import { defineConfig } from "@revnixhq/nextly/config";
import { formBuilder } from "@revnixhq/plugin-form-builder";

const myFormPlugin = formBuilder({
  notifications: { defaultFrom: "noreply@example.com" },
});

export default defineConfig({
  plugins: [myFormPlugin.plugin],
  collections: [...myFormPlugin.collections],
});
```

## What this plugin adds

- **Admin routes:** `/admin/collections/forms` (list and edit forms), `/admin/collections/form-submissions` (browse submissions, filter by form)
- **Collections:** `forms`, `form-submissions`
- **Field types:** Text, Email, Number, Textarea, Select, Radio, Checkbox, Date, Country, State
- **Form lifecycle:** Draft, Published, Closed states
- **Optional integrations:** email notifications, webhook delivery on submission

## Admin styling

The plugin's admin UI ships separate CSS bundles. Import them in your admin route page:

```tsx
import "@revnixhq/plugin-form-builder/admin";
import "@revnixhq/plugin-form-builder/styles/builder.css";
import "@revnixhq/plugin-form-builder/styles/submissions-filter.css";
```

## Main exports

- `formBuilderPlugin` – the default plugin instance (use this for the standard setup)
- `formBuilder` – factory for customized instances
- Type exports: `FormBuilderConfig`, `FormBuilderPluginResult`, `FormDocument`, `SubmissionDocument`, `FormSubmission`, `EmailConfig`, `WebhookConfig`, `WebhookEvent`

## Compatibility

- `@revnixhq/nextly` ≥ 0.0.x
- `@revnixhq/admin` ≥ 0.0.x

Plugins can break across minor versions during alpha. Pin exact versions of `nextly`, `admin`, and this plugin together.

## Documentation

**[Form Builder plugin docs →](https://nextlyhq.com/docs/plugins/form-builder)**

## Related packages

- [`@revnixhq/nextly`](../nextly)
- [`@revnixhq/admin`](../admin)

## License

[MIT](../../LICENSE.md)
