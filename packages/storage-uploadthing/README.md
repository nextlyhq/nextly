# @revnixhq/storage-uploadthing

[UploadThing](https://uploadthing.com) storage adapter for [Nextly](https://github.com/revnix/nextly-dev). Stores files on UploadThing's CDN and serves them from `utfs.io`.

## Installation

```bash
pnpm add @revnixhq/storage-uploadthing
```

`@revnixhq/storage-uploadthing` expects `@revnixhq/nextly` to be installed alongside it.

## Required credentials

Set the `UPLOADTHING_TOKEN` environment variable (recommended) or pass `token` explicitly. Get the token from the UploadThing dashboard under **API Keys**.

## Quick start

```typescript
import { defineConfig } from "@revnixhq/nextly/config";
import { uploadthingStorage } from "@revnixhq/storage-uploadthing";

export default defineConfig({
  storage: [
    uploadthingStorage({
      token: process.env.UPLOADTHING_TOKEN,
      collections: {
        media: true,
      },
    }),
  ],
});
```

## Configuration

| Option        | Type                                                 | Default | Notes                                    |
| ------------- | ---------------------------------------------------- | ------- | ---------------------------------------- |
| `token`       | `string`                                             | env     | Falls back to `UPLOADTHING_TOKEN`.       |
| `collections` | `Record<string, boolean \| CollectionStorageConfig>` | —       | **Required.**                            |
| `enabled`     | `boolean`                                            | `true`  | Disables the plugin without removing it. |

UploadThing's adapter surface is intentionally small — most behavior is controlled by your UploadThing project settings, not the adapter.

## Limitations

- **Public CDN only.** All uploads land on the public `utfs.io` CDN. There is no private-bucket mode and no signed download URLs.
- **No client-side upload URLs from this adapter.** UploadThing has its own client-upload pattern (`UploadButton` / `UploadDropzone` from `@uploadthing/react`); this adapter does not generate `getClientUploadUrl` data.
- **Delete errors are silently swallowed.** A failed single delete (e.g. file already gone) does not throw. A failed `bulkDelete` reports all keys as failed (all-or-nothing) rather than per-key.

## Security defaults

- **`contentDisposition` defaults to `'attachment'`** ([T-028](https://github.com/revnix/nextly-dev)). User-uploaded HTML, SVG, and PDF files get the browser download dialog instead of being rendered in-context, which mitigates stored-XSS and drive-by-download from authenticated user uploads. Adopters who genuinely want inline rendering must pass `contentDisposition: 'inline'` explicitly.
- **Filenames are sanitized** to `[a-zA-Z0-9._-]` before upload. Path separators are stripped.

## Documentation

See the [main repository](https://github.com/revnix/nextly-dev) for full Nextly documentation.

## Governance

- [Security policy](https://github.com/revnix/nextly-dev/blob/dev/SECURITY.md) — report vulnerabilities privately
- [Code of Conduct](https://github.com/revnix/nextly-dev/blob/dev/CODE_OF_CONDUCT.md)
- [Contributing](https://github.com/revnix/nextly-dev/blob/dev/CONTRIBUTING.md)
- [License (MIT)](./LICENSE)
