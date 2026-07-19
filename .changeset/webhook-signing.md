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
"@nextlyhq/tsconfig": patch
"@nextlyhq/ui": patch
---

Add Standard Webhooks payload signing.

Pure signing primitives for outbound webhook deliveries: `signPayload` and `buildSignatureHeaders` produce the `webhook-id`/`webhook-timestamp`/`webhook-signature` headers (`v1,<base64 HMAC-SHA256 of "<id>.<timestamp>.<body>">`), and `verifySignature` is a constant-time verify helper covering secret rotation. `whsec_`-prefixed secrets are base64-decoded to key bytes. The delivery engine wires these in later; secrets live encrypted at rest and are decrypted before signing.
