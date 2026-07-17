# @nextlyhq/plugin-form-builder

Drag-and-drop form builder plugin for Nextly. Build forms visually, collect submissions, and filter them by form. _Coming soon in beta._

<p align="center">
  <a href="https://www.npmjs.com/package/@nextlyhq/plugin-form-builder"><img alt="npm" src="https://img.shields.io/npm/v/@nextlyhq/plugin-form-builder?style=flat-square&label=npm&color=cb3837" /></a>
  <a href="https://github.com/nextlyhq/nextly/blob/main/LICENSE.md"><img alt="License" src="https://img.shields.io/github/license/nextlyhq/nextly?style=flat-square&color=blue" /></a>
  <a href="https://nextlyhq.com/docs"><img alt="Status" src="https://img.shields.io/badge/status-alpha-orange?style=flat-square" /></a>
</p>

> [!WARNING]
> **Coming soon in beta. Plugins are not ready for use yet.** Public plugin support, including stable APIs, the official plugin gallery, and documentation guarantees, lands at the Nextly **beta** release. This package is published for early exploration only. Surfaces, names, and behaviour will change without notice. Do not rely on plugins for production or serious development work. Wait for the beta release announcement before integrating plugins into your project.

> [!IMPORTANT]
> Nextly is in alpha. APIs may change before 1.0. Pin exact versions in production.

## What it is

A first-party Nextly plugin that adds a visual form builder to the admin panel and a `form-submissions` collection for capturing entries. Users design forms by dragging fields onto a canvas; submissions are stored in your database and browsable in the admin.

Install this whenever you want admin-managed forms (contact, signup, newsletter, surveys) without writing a backend.

## Installation

```bash
pnpm add @nextlyhq/plugin-form-builder
```

## Quick usage

Register the plugin in `nextly.config.ts`:

```ts
import { defineConfig } from "nextly/config";
import { formBuilder } from "@nextlyhq/plugin-form-builder";

const fb = formBuilder({
  notifications: { defaultFrom: "noreply@example.com" },
});

export default defineConfig({
  plugins: [fb.plugin],
  collections: [...fb.collections],
});
```

> A `formBuilderPlugin` default-instance shortcut is also exported for cases where no customization is needed. See [the plugin docs](https://nextlyhq.com/docs/plugins/form-builder) for the full options reference.

## Admin styling

The plugin's admin UI requires two imports in your admin route page so the builder and submissions filter render correctly:

```tsx
// app/admin/[[...params]]/page.tsx
import "@nextlyhq/plugin-form-builder/admin";
import "@nextlyhq/plugin-form-builder/styles/submissions-filter.css";
```

## What this plugin adds

- **Admin routes:** `/admin/collections/forms` and `/admin/collections/form-submissions`
- **Collections:** `forms`, `form-submissions`
- **Form lifecycle states:** Draft, Published, Closed
- **Optional integrations:** email notifications, webhook delivery on submission, spam protection (honeypot, rate limit, reCAPTCHA v3)

## Field types

The plugin ships 13 field types. All are enabled by default; disable any by setting it to `false` in the `fields` option.

| Type       | Description                          |
| ---------- | ------------------------------------ |
| `text`     | Single-line text input               |
| `email`    | Email address with format validation |
| `number`   | Numeric input                        |
| `phone`    | Phone number input                   |
| `url`      | URL with format validation           |
| `textarea` | Multi-line text input                |
| `select`   | Dropdown menu                        |
| `checkbox` | Single boolean toggle                |
| `radio`    | Radio button group                   |
| `file`     | File upload                          |
| `date`     | Date picker                          |
| `time`     | Time picker                          |
| `hidden`   | Hidden value (not shown to users)    |

See the [Field types reference](https://nextlyhq.com/docs/plugins/form-builder#field-types) for full options on each type.

## Main exports

- `formBuilder`: factory for customized plugin instances
- `formBuilderPlugin`: pre-configured default instance
- Field helpers: `text`, `email`, `number`, `phone`, `url`, `textarea`, `select`, `checkbox`, `radio`, `file`, `date`, `time`, `hidden`, `option`
- Server helpers: `submitForm`, `validateSubmission`, `getFormSubmissionStats`, `createFormConfig`, `validateFormConfig`, `assertValidFormConfig`
- Export utilities: `exportToCSV`, `exportToJSON`, `exportAndDownload`, `downloadFile`, `generateExportFilename`
- Collections: `formsCollection`, `submissionsCollection`
- Type exports: `FormDocument`, `SubmissionDocument`, `FormSubmission`, `EmailConfig`, `WebhookConfig`, `WebhookEvent`, `FormFieldOption`, `SubmissionListProps`, `SubmissionDetailProps`

## Compatibility

| Tool              | Version |
| ----------------- | ------- |
| Node.js           | 20+     |
| `nextly`          | 0.0.x   |
| `@nextlyhq/admin` | 0.0.x   |

Plugins can break across minor versions during alpha. Pin exact versions of `nextly`, `@nextlyhq/admin`, and this plugin together.

## Documentation

- [**Form Builder plugin docs**](https://nextlyhq.com/docs/plugins/form-builder): full configuration, field options, server helpers, webhooks, exports
- [**Plugins overview**](https://nextlyhq.com/docs/plugins): how the plugin system works
- [**Email configuration**](https://nextlyhq.com/docs/guides/email): set up providers and templates for form notifications

## Related packages

- [`nextly`](../nextly): the core runtime
- [`@nextlyhq/admin`](../admin): the admin panel that hosts the builder UI

## License

[MIT](../../LICENSE.md)
