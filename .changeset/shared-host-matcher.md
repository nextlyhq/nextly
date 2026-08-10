---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/ui": patch
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
---

Move the remote-host policy into the engine so one matcher can serve both the compiler and the renderer.

Which hosts a page may fetch from is asked from two places that must not answer differently: the style compiler judging a `url()` in a stored value, and a React block judging an `img` or `iframe` source. Only the first could ask, because the matcher lived beside the page builder's own compiler. A second implementation for the renderer would be a second thing to be wrong, and two that drift apart fail silently, one permitting what the other refuses.

`isFetchableUrl`, `isAllowedRemoteUrl`, `isRemoteUrl`, `normalizeUrl` and the `RemotePattern` types now live in `@nextlyhq/blocks-engine` and are exported from it. The page builder re-exports them, so every existing import is untouched and no behaviour changes.

The engine's runtime-free allowlist gains `picomatch`, deliberately and with its reason recorded beside `css-tree`'s: it is the glob grammar `next/image`'s `remotePatterns` is written in, so reading the same patterns a Nextly app already declares means reading that grammar. Re-implementing it inside a security control to avoid a dependency would trade a known matcher for an unknown one. It has no dependencies of its own, imports no Node builtins, and already runs in a browser through the page builder's canvas.
