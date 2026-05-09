declare module "@nextlyhq/storage-vercel-blob" {
  export function vercelBlobStorage(config: Record<string, unknown>): unknown;
}

declare module "@nextlyhq/storage-s3" {
  export function s3Storage(config: Record<string, unknown>): unknown;
}
