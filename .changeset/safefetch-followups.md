---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"nextly": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/ui": patch
---

Fix two safeFetch edge cases from the IP-pinning change.

An empty 2xx/204/304 response that still carries a `Content-Encoding` header no longer fails: inflating zero bytes threw and turned a valid empty delivery into a `SafeFetchError`, so `decodeBody` now passes an empty body straight through.

A URL-backed email attachment that exceeds the size limit now surfaces the same `EMAIL_ATTACHMENT_SIZE_EXCEEDED` validation error the local/S3 path produces, rather than an opaque storage-read failure: the fetch translates a `response-too-large` result into the size-exceeded error, and the attachment resolver passes a typed `NextlyError` from `readBytes` through instead of re-wrapping it.
