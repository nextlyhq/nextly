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

Refresh five transitive dependencies to their patched releases, clearing the six open Dependabot advisories on this repository.

`brace-expansion` to 5.0.9 (denial of service through unbounded intermediate arrays, bypassing the earlier mitigation), `fast-uri` to 3.1.5 (host confusion via a backslash authority introducer), `js-yaml` to 4.3.1 (quadratic CPU consumption resolving `!!omap`), `undici` to 7.29.0 (five advisories, the highest being cross-user information disclosure and a parse-time crash on degenerate private cache directives) and `dompurify` to 3.4.13.

The DOMPurify advisory is the one worth an explicit reachability answer, because two published packages sanitize with it. Reaching it needs `IN_PLACE` sanitization together with a hook that removes a containing element, and neither sanitizer is that shape: `sanitize-svg` hooks `uponSanitizeAttribute`, the embed sanitizer hooks `afterSanitizeAttributes`, both are attribute-level, and neither sets `IN_PLACE`. So the bump keeps a dependency on a supported release rather than closing a live hole. Both sanitizer suites pass on 3.4.13.

Each override floor is raised rather than left to resolve upward on its own, because all five were pinned in the lockfile at exactly the last vulnerable patch, and a floor that still admits a vulnerable version lets the next lockfile refresh land back on one.

These are `pnpm` overrides, so they govern this workspace's builds, CI and local development and do not travel with the published packages. What a consumer of `nextly` or `@nextlyhq/plugin-page-builder` resolves for these transitive dependencies is still decided by their own tree.
