# @revnixhq/storage-vercel-blob

[Vercel Blob](https://vercel.com/docs/storage/vercel-blob) storage adapter for Nextly. Optimized for Vercel deployments with built-in support for client-side uploads to bypass the 4.5 MB serverless body limit.

<p align="center">
  <a href="https://www.npmjs.com/package/@revnixhq/storage-vercel-blob"><img alt="npm" src="https://img.shields.io/npm/v/@revnixhq/storage-vercel-blob?style=flat-square&label=npm&color=cb3837" /></a>
  <a href="https://github.com/nextlyhq/nextly/blob/main/LICENSE.md"><img alt="License" src="https://img.shields.io/github/license/nextlyhq/nextly?style=flat-square&color=blue" /></a>
  <a href="https://nextlyhq.com/docs"><img alt="Status" src="https://img.shields.io/badge/status-alpha-orange?style=flat-square" /></a>
</p>

> [!IMPORTANT]
> Nextly is in alpha. APIs may change before 1.0. Pin exact versions in production.

## What it is

Stores Nextly media uploads on Vercel Blob. The simplest option if you are deploying to Vercel and want zero infrastructure setup. Client-side uploads (large files bypass the serverless body limit) are enabled with one config flag.

## Installation

```bash
pnpm add @revnixhq/storage-vercel-blob
```

## Quick usage

Register the storage adapter in `nextly.config.ts`:

```ts
import { defineConfig } from "@revnixhq/nextly/config";
import { vercelBlobStorage } from "@revnixhq/storage-vercel-blob";

export default defineConfig({
  storage: [
    vercelBlobStorage({
      token: process.env.BLOB_READ_WRITE_TOKEN!,
      collections: { media: true },
    }),
  ],
});
```

## Required environment variables

| Variable                | Required? | Default | Notes                                                                  |
| ----------------------- | --------- | ------- | ---------------------------------------------------------------------- |
| `BLOB_READ_WRITE_TOKEN` | yes       | (none)  | Provisioned automatically by Vercel when you enable Blob in a project. |

## Client-side uploads

For files larger than ~4.5 MB on Vercel's serverless functions, enable client uploads:

```ts
vercelBlobStorage({
  token: process.env.BLOB_READ_WRITE_TOKEN!,
  collections: {
    media: { clientUploads: true },
  },
});
```

The admin uploader hands the file to the browser-side SDK, which uploads directly to Blob. Server only signs the upload.

## Main exports

- `vercelBlobStorage` – plugin factory for `defineConfig.storage`
- `VercelBlobStorageAdapter` – the adapter class (advanced)
- Type exports: `VercelBlobStorageConfig`

## Compatibility

- Node.js 18+
- `@vercel/blob` (peer)
- `@revnixhq/nextly` 0.0.x

## Documentation

**[Vercel Blob storage docs →](https://nextlyhq.com/docs/guides/media-storage)**

## Related packages

- [`@revnixhq/storage-s3`](../storage-s3)
- [`@revnixhq/storage-uploadthing`](../storage-uploadthing)

## License

[MIT](../../LICENSE.md)
