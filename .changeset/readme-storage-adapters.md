---
"@revnixhq/storage-s3": patch
"@revnixhq/storage-vercel-blob": patch
"@revnixhq/storage-uploadthing": patch
---

Tight-archetype README rework for the storage adapter family:

- Each README lists its required env vars in a 3-column table
- `storage-s3` README adds R2 and MinIO setup snippets and a per-collection configuration example
- `storage-vercel-blob` README documents client-uploads (bypasses the 4.5 MB serverless limit)
- Removed stale `github.com/revnix/nextly-dev` links from `storage-s3`, `storage-vercel-blob`, `storage-uploadthing`
- Aligned alpha banner wording with spec
