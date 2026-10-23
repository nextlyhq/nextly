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
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-mcp": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

Move to Next.js 16.4.1 or later and sharp 0.35.5 or later. Next.js releases before 16.4.1 (and before 15.5.28 on the 15 line) carry two critical advisories that allow unauthenticated remote code execution, and sharp before 0.35.5 carries the librsvg vulnerability one of them depends on:

- [GHSA-673q-mjm6-r5xr](https://github.com/advisories/GHSA-673q-mjm6-r5xr) (critical): remote code execution in `use cache` functions returning typed arrays, Next.js 16.0.0 to 16.4.0, fixed in 16.4.1.
- [GHSA-2464-fhr4-w9xw](https://github.com/advisories/GHSA-2464-fhr4-w9xw) (critical): remote code execution in Image Optimization when SVG files are used, fixed in Next.js 15.5.28 and 16.4.1, and by sharp 0.35.5 or later.
- [GHSA-wq5f-xc86-pv6w](https://github.com/advisories/GHSA-wq5f-xc86-pv6w) (high): the librsvg vulnerability in sharp before 0.35.5.
- [GHSA-p3m5-59mp-jv5r](https://github.com/advisories/GHSA-p3m5-59mp-jv5r) (high): denial of service in the App Router through Server Actions, fixed in Next.js 15.5.28 and 16.4.1.

Every package that declares a peer on `next` now asks for `^15.5.28 || ^16.4.1`, and `nextly`'s optional peer on `sharp` asks for `^0.35.5`, so a project on an affected version sees a peer warning when it installs. Next.js 14 is no longer supported: no 14.x release fixes GHSA-2464-fhr4-w9xw. To upgrade, run `pnpm add next@latest sharp@latest` (or your package manager's equivalent).
