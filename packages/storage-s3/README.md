# @revnixhq/storage-s3

Amazon S3 (and S3-compatible: Cloudflare R2, MinIO, Backblaze B2, Wasabi, DigitalOcean Spaces) storage adapter for Nextly.

<p align="center">
  <a href="https://www.npmjs.com/package/@revnixhq/storage-s3"><img alt="npm" src="https://img.shields.io/npm/v/@revnixhq/storage-s3?style=flat-square&label=npm&color=cb3837" /></a>
  <a href="https://github.com/nextlyhq/nextly/blob/main/LICENSE.md"><img alt="License" src="https://img.shields.io/github/license/nextlyhq/nextly?style=flat-square&color=blue" /></a>
  <a href="https://nextlyhq.com/docs"><img alt="Status" src="https://img.shields.io/badge/status-alpha-orange?style=flat-square" /></a>
</p>

> [!IMPORTANT]
> Nextly is in alpha. APIs may change before 1.0. Pin exact versions in production.

## What it is

Stores Nextly media uploads on Amazon S3 or any S3-compatible object store. R2, MinIO, B2, Wasabi, and DigitalOcean Spaces all work via the same adapter; you do not need separate packages.

## Installation

```bash
pnpm add @revnixhq/storage-s3
```

## Quick usage

Register the storage adapter in `nextly.config.ts`:

```ts
import { defineConfig } from "@revnixhq/nextly/config";
import { s3Storage } from "@revnixhq/storage-s3";

export default defineConfig({
  storage: [
    s3Storage({
      bucket: process.env.S3_BUCKET!,
      region: process.env.AWS_REGION!,
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      collections: { media: true },
    }),
  ],
});
```

## Required environment variables

| Variable                | Required?                   | Default | Notes                         |
| ----------------------- | --------------------------- | ------- | ----------------------------- |
| `S3_BUCKET`             | yes                         | (none)  |                               |
| `AWS_REGION`            | yes for AWS                 | (none)  | Use `auto` for Cloudflare R2. |
| `AWS_ACCESS_KEY_ID`     | yes (if not using IAM role) | (none)  |                               |
| `AWS_SECRET_ACCESS_KEY` | yes (if not using IAM role) | (none)  |                               |

You can also pass these explicitly to `s3Storage(...)` instead of using env vars.

## Cloudflare R2

```ts
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

## MinIO

```ts
s3Storage({
  bucket: "my-bucket",
  region: "us-east-1",
  endpoint: "https://minio.example.com",
  forcePathStyle: true,
  accessKeyId: process.env.MINIO_ACCESS_KEY!,
  secretAccessKey: process.env.MINIO_SECRET_KEY!,
  collections: { media: true },
});
```

## Per-collection configuration

```ts
s3Storage({
  bucket: "my-bucket",
  region: "us-east-1",
  collections: {
    media: true,
    "private-docs": {
      prefix: "private/",
      clientUploads: true,
      signedDownloads: true,
      signedUrlExpiresIn: 3600,
    },
  },
});
```

## Main exports

- `s3Storage` – plugin factory for `defineConfig.storage`
- `S3StorageAdapter` – the adapter class (advanced)
- Type exports: `S3StorageConfig`, `S3CollectionConfig`

## Compatibility

- Node.js 18+
- `@revnixhq/nextly` 0.0.x
- AWS S3, Cloudflare R2, MinIO, Backblaze B2, Wasabi, DigitalOcean Spaces

## Documentation

**[S3 storage docs →](https://nextlyhq.com/docs/guides/media-storage)**

## Related packages

- [`@revnixhq/storage-vercel-blob`](../storage-vercel-blob)
- [`@revnixhq/storage-uploadthing`](../storage-uploadthing)

## License

[MIT](../../LICENSE.md)
