# @revnixhq/storage-vercel-blob

[Vercel Blob](https://vercel.com/docs/storage/vercel-blob) storage adapter for [Nextly](https://github.com/revnix/nextly-dev). Optimized for Vercel deployments with built-in support for client-side uploads to bypass the 4.5 MB serverless body limit.

## Installation

```bash
pnpm add @revnixhq/storage-vercel-blob
```

`@revnixhq/storage-vercel-blob` expects `@revnixhq/nextly` to be installed alongside it.

## Required credentials

Set the `BLOB_READ_WRITE_TOKEN` environment variable (recommended) or pass `token` explicitly. Get the token from **Vercel Dashboard → Storage → Blob → Tokens**. The adapter throws at boot if the token is missing.

## Quick start

```typescript
import { defineConfig } from "@revnixhq/nextly/config";
import { vercelBlobStorage } from "@revnixhq/storage-vercel-blob";

export default defineConfig({
  storage: [
    vercelBlobStorage({
      token: process.env.BLOB_READ_WRITE_TOKEN,
      collections: {
        media: true,
      },
    }),
  ],
});
```

## Client uploads (recommended on Vercel)

Vercel serverless functions cap request bodies at **4.5 MB**. For anything larger, enable `clientUploads: true` on the collection — the browser uploads directly to Vercel Blob and only metadata flows through your server route:

```typescript
vercelBlobStorage({
  collections: {
    media: {
      clientUploads: true,
    },
  },
});
```

Client uploads require a `handleUpload` route handler using `@vercel/blob/client`. See the [Vercel Blob client uploads docs](https://vercel.com/docs/storage/vercel-blob/client-upload).

## Configuration

| Option               | Type                                                    | Default    | Notes                                                     |
| -------------------- | ------------------------------------------------------- | ---------- | --------------------------------------------------------- |
| `token`              | `string`                                                | env        | Falls back to `BLOB_READ_WRITE_TOKEN`.                    |
| `collections`        | `Record<string, boolean \| VercelBlobCollectionConfig>` | —          | **Required.**                                             |
| `addRandomSuffix`    | `boolean`                                               | `true`     | Appends a random suffix to filenames to avoid collisions. |
| `cacheControlMaxAge` | `number`                                                | `31536000` | Seconds. Vercel enforces a 60s minimum.                   |
| `allowOverwrite`     | `boolean`                                               | `false`    | Only relevant when `addRandomSuffix: false`.              |
| `storeId`            | `string`                                                | —          | Required if your Vercel project has multiple Blob stores. |
| `multipartThreshold` | `number`                                                | `5242880`  | Files above this size use multipart upload.               |
| `access`             | `'public'`                                              | `'public'` | Vercel Blob does not support private access.              |
| `enabled`            | `boolean`                                               | `true`     | Disables the plugin without removing it.                  |

`addRandomSuffix` and `allowOverwrite` can be overridden per collection.

## Per-collection configuration

```typescript
vercelBlobStorage({
  collections: {
    media: { prefix: "uploads/" },
    documents: {
      prefix: "docs/",
      addRandomSuffix: false,
      allowOverwrite: true,
      clientUploads: true,
    },
  },
});
```

## Limitations & behavioral notes

- **All blobs are publicly accessible by URL.** Vercel Blob has no private mode and no signed download URLs. Do not use this adapter for files that must be access-controlled — use [`@revnixhq/storage-s3`](../storage-s3) with `acl: 'private'` instead.
- **SVG and HTML uploads are hard-rejected.** Vercel Blob cannot serve objects with a per-object `Content-Disposition: attachment` or restrictive CSP, so SVG/HTML/XHTML uploads would be stored XSS. The adapter throws on attempted uploads of MIME types `image/svg+xml`, `text/html`, `application/xhtml+xml`, and extensions `svg`, `svgz`, `html`, `htm`, `xhtml`. Use the S3/R2 adapter for these file types or convert SVGs to PNG/WebP before upload.
- **Folder prefixes are sanitized.** `..`, leading `/`, and other path-traversal patterns are rejected at upload time. Existing collection prefixes containing `..` will hard-error after this version.
- **`addRandomSuffix` defaults to `true`.** Disabling it without setting `allowOverwrite: true` will throw on duplicate filenames.

## Documentation

See the [main repository](https://github.com/revnix/nextly-dev) for full Nextly documentation.

## Governance

- [Security policy](https://github.com/revnix/nextly-dev/blob/dev/SECURITY.md) — report vulnerabilities privately
- [Code of Conduct](https://github.com/revnix/nextly-dev/blob/dev/CODE_OF_CONDUCT.md)
- [Contributing](https://github.com/revnix/nextly-dev/blob/dev/CONTRIBUTING.md)
- [License (MIT)](./LICENSE)
