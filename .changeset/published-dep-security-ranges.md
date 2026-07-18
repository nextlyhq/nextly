---
"nextly": patch
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"@nextlyhq/ui": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"create-nextly-app": patch
---

Raise the published dependency ranges that carried security advisories, so consumers installing these packages can no longer resolve a vulnerable version. Root `pnpm` overrides only protect this repository's own lockfile; these are the direct-range bumps that travel with the published packages.

- `nextly`: `ws` `^8.18.0` → `^8.21.1`. The floor now excludes `ws` before `8.21.1` (memory-exhaustion DoS, plus CVE-2026-62389 fixed in `8.21.1`).
- `create-nextly-app`: `tar` `^7.4.0` → `^7.5.19`. `create-nextly-app` extracts downloaded GitHub tarballs via `tar.x`; the floor now excludes the `<=7.5.18` path-traversal / file-smuggling line (patched in `7.5.19`).
- `@nextlyhq/storage-s3`: `@aws-sdk/client-s3`, `@aws-sdk/lib-storage`, `@aws-sdk/s3-request-presigner` `^3.966.0` → `^3.1090.0`; the newer AWS SDK no longer pulls the vulnerable `fast-xml-parser` into the S3 path.

Deliberately NOT changed (documented so a version bump is not mistaken for a fix):

- `isomorphic-dompurify` (`nextly`, `@nextlyhq/plugin-page-builder`) stays at `^2`. The DOMPurify `ALLOWED_ATTR` advisory is fixed in `dompurify 3.4.11`, but the first `isomorphic-dompurify` version that lower-bounds its bundled DOMPurify there is the `3.x` major, which requires Node `^20.19.0 || ^22.13.0 || >=24` (via `jsdom@29`) and would drop Nextly's advertised `node >=20.0.0`. That trade-off is not worth it for a moderate issue that a fresh install already avoids (`^2` resolves DOMPurify to the patched `3.4.12`). Raising the floor here is deferred to a future Node-support bump.
- `@nextlyhq/storage-vercel-blob` is unchanged. Its only advisory transitive (`undici`) comes through `@vercel/blob`, which pins `undici ^6.x` on every release, so no `@vercel/blob` range reaches a patched floor for stale consumer lockfiles; a fresh install already resolves the patched `undici 6.27.x`. This is upstream-bound. The package is listed above only because releases version in lockstep — this release does not itself change `@nextlyhq/storage-vercel-blob`'s dependencies.
