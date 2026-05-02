# @revnixhq/storage-s3

AWS S3 storage adapter for [Nextly](https://github.com/revnix/nextly-dev) — supports S3, Cloudflare R2, MinIO, and other S3-compatible object stores.

## Installation

```bash
pnpm add @revnixhq/storage-s3
```

`@revnixhq/storage-s3` expects `@revnixhq/nextly` to be installed alongside it.

## Required credentials

Provide credentials via either explicit config or AWS-SDK-standard environment variables (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, optionally `AWS_REGION`). The SDK picks them up natively if you omit them from the config.

## Quick start

```typescript
import { defineConfig } from "@revnixhq/nextly/config";
import { s3Storage } from "@revnixhq/storage-s3";

export default defineConfig({
  storage: [
    s3Storage({
      bucket: process.env.S3_BUCKET!,
      region: process.env.AWS_REGION!,
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      collections: {
        media: true,
      },
    }),
  ],
});
```

## Configuration

| Option               | Type                       | Default                      | Notes                                         |
| -------------------- | -------------------------- | ---------------------------- | --------------------------------------------- |
| `bucket`             | `string`                   | —                            | **Required.** Must already exist.             |
| `region`             | `string`                   | —                            | **Required.** Use `'auto'` for Cloudflare R2. |
| `accessKeyId`        | `string`                   | env                          | Falls back to `AWS_ACCESS_KEY_ID`.            |
| `secretAccessKey`    | `string`                   | env                          | Falls back to `AWS_SECRET_ACCESS_KEY`.        |
| `endpoint`           | `string`                   | —                            | Required for R2, MinIO, Spaces.               |
| `forcePathStyle`     | `boolean`                  | `false`                      | Required for MinIO.                           |
| `acl`                | `S3ObjectACL`              | `'private'`                  | See **Security defaults** below.              |
| `publicUrl`          | `string`                   | —                            | CDN/custom-domain URL. Required for R2.       |
| `signedDownloads`    | `boolean`                  | `false`                      | Generate signed URLs for private objects.     |
| `signedUrlExpiresIn` | `number`                   | `3600`                       | Seconds.                                      |
| `cacheControl`       | `string`                   | `'public, max-age=31536000'` | Sent on every upload.                         |
| `contentDisposition` | `'inline' \| 'attachment'` | unset                        | See **Security defaults**.                    |
| `enabled`            | `boolean`                  | `true`                       | Disables the plugin without removing it.      |

`acl`, `cacheControl`, and `contentDisposition` can be overridden per collection.

## Provider examples

### Cloudflare R2

```typescript
s3Storage({
  bucket: process.env.R2_BUCKET!,
  region: "auto",
  accessKeyId: process.env.R2_ACCESS_KEY_ID!,
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  publicUrl: process.env.R2_PUBLIC_URL,
  collections: { media: true },
});
```

### MinIO (self-hosted)

```typescript
s3Storage({
  bucket: "my-bucket",
  region: "us-east-1",
  endpoint: "http://localhost:9000",
  forcePathStyle: true,
  accessKeyId: process.env.MINIO_ACCESS_KEY!,
  secretAccessKey: process.env.MINIO_SECRET_KEY!,
  collections: { media: true },
});
```

### DigitalOcean Spaces

```typescript
s3Storage({
  bucket: "my-space",
  region: "nyc3",
  endpoint: "https://nyc3.digitaloceanspaces.com",
  collections: { media: true },
});
```

## Per-collection configuration

```typescript
s3Storage({
  bucket: "my-bucket",
  region: "us-east-1",
  collections: {
    media: true,
    "private-docs": {
      prefix: "docs/",
      acl: "private",
      signedDownloads: true,
      signedUrlExpiresIn: 900,
      clientUploads: true,
    },
  },
});
```

## Client uploads & signed URLs

Enable `clientUploads: true` on a collection to bypass server-side upload limits (e.g. Vercel's 4.5 MB serverless body cap). The plugin exposes `getClientUploadUrl(filename, mimeType, collection)` for the admin UI to call. Enable `signedDownloads: true` to serve private objects via short-lived signed URLs.

## Security defaults

- **`acl` defaults to `'private'`.** Uploaded objects are not world-readable unless you explicitly opt in to `'public-read'` (or pair with a public-read bucket policy).
- **Filenames are sanitized** to `[a-zA-Z0-9._-]` before being used as S3 keys. Path separators are stripped.
- **Cloudflare R2 ignores ACL.** Configure public access in the R2 dashboard or use a `publicUrl` to a CDN-fronted public bucket.
- **`contentDisposition`** is unset by default. For collections that accept user-uploaded HTML, SVG, or PDF, set `contentDisposition: 'attachment'` to force the download dialog instead of inline rendering — protects against stored XSS.

## Documentation

See the [main repository](https://github.com/revnix/nextly-dev) for full Nextly documentation.

## Governance

- [Security policy](https://github.com/revnix/nextly-dev/blob/dev/SECURITY.md) — report vulnerabilities privately
- [Code of Conduct](https://github.com/revnix/nextly-dev/blob/dev/CODE_OF_CONDUCT.md)
- [Contributing](https://github.com/revnix/nextly-dev/blob/dev/CONTRIBUTING.md)
- [License (MIT)](./LICENSE)
