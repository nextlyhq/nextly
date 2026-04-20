declare module "@revnixhq/storage-vercel-blob" {
  export function vercelBlobStorage(config: Record<string, unknown>): unknown;
}

declare module "@revnixhq/storage-s3" {
  export function s3Storage(config: Record<string, unknown>): unknown;
}
