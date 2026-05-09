# @nextlyhq/storage-uploadthing

[UploadThing](https://uploadthing.com?utm_source=nextly&utm_medium=readme) storage adapter for Nextly. Stores media on UploadThing's CDN and serves them from `utfs.io`.

<p align="center">
  <a href="https://www.npmjs.com/package/@nextlyhq/storage-uploadthing"><img alt="npm" src="https://img.shields.io/npm/v/@nextlyhq/storage-uploadthing?style=flat-square&label=npm&color=cb3837" /></a>
  <a href="https://github.com/nextlyhq/nextly/blob/main/LICENSE.md"><img alt="License" src="https://img.shields.io/github/license/nextlyhq/nextly?style=flat-square&color=blue" /></a>
  <a href="https://nextlyhq.com/docs"><img alt="Status" src="https://img.shields.io/badge/status-alpha-orange?style=flat-square" /></a>
</p>

> [!IMPORTANT]
> Nextly is in alpha. APIs may change before 1.0. Pin exact versions in production.

## What it is

Stores Nextly media uploads on UploadThing. Useful if you already use UploadThing for the rest of your Next.js stack, or want a managed CDN with no AWS account setup.

> **You do not need this for development.** Nextly's default storage is local disk under `./public/uploads/`. Install this when you are ready to move uploads to UploadThing, typically for production.

## Installation

```bash
pnpm add @nextlyhq/storage-uploadthing
```

## Quick usage

Register the storage adapter in `nextly.config.ts`:

```ts
import { defineConfig } from "nextly/config";
import { uploadthingStorage } from "@nextlyhq/storage-uploadthing";

export default defineConfig({
  storage: [
    uploadthingStorage({
      token: process.env.UPLOADTHING_TOKEN!,
      collections: { media: true },
    }),
  ],
});
```

## Required environment variables

| Variable            | Required? | Default | Notes                                             |
| ------------------- | --------- | ------- | ------------------------------------------------- |
| `UPLOADTHING_TOKEN` | yes       | (none)  | Find in the UploadThing dashboard under API keys. |

## Main exports

- `uploadthingStorage`: plugin factory for `defineConfig.storage`
- `UploadthingStorageAdapter`: the adapter class (advanced)
- Type exports: `UploadthingStorageConfig`

## Compatibility

| Tool          | Version |
| ------------- | ------- |
| Node.js       | 20+     |
| `uploadthing` | peer    |
| `nextly`      | 0.0.x   |

## Documentation

- [**Media and storage docs**](https://nextlyhq.com/docs/guides/media-storage)

## Related packages

- [`@nextlyhq/storage-s3`](../storage-s3)
- [`@nextlyhq/storage-vercel-blob`](../storage-vercel-blob)

## License

[MIT](../../LICENSE.md)
