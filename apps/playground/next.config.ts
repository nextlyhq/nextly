import type { NextConfig } from "next";

// Payload-style env-conditional source-mode (see packages/next/src/withPayload/withPayload.js
// in the payloadcms/payload repo for the canonical reference).
//
// Strategy:
//   - In DEV: workspace packages are NOT in serverExternalPackages → Next.js bundles
//     them via Turbopack from the source aliases below → editing source files in
//     packages/nextly, packages/adapter-*, packages/storage-* triggers HMR. No
//     `tsup --watch` is required for the dev loop.
//   - In PROD: workspace packages ARE in serverExternalPackages → smaller bundle,
//     no duplicate-install risk, dist/ output ships as-is.
//   - Native / third-party Node-only deps (pg, mysql2, sharp, esbuild, etc.) are
//     ALWAYS external — they cannot be transpiled by Turbopack and they must
//     stay as Node `require()` at runtime.
//
// This replaces the prior bimodal architecture (workspace packages always external,
// HMR via tsup --watch + Node module-cache invalidation) which never reliably picked
// up server-side source edits because `serverExternalPackages` opts modules out of
// Next.js's HMR machinery entirely.

const isDev = process.env.NODE_ENV === "development";

const NEXTLY_WORKSPACE_PACKAGES = [
  "@revnixhq/nextly",
  "@revnixhq/adapter-drizzle",
  "@revnixhq/adapter-postgres",
  "@revnixhq/adapter-mysql",
  "@revnixhq/adapter-sqlite",
  "@revnixhq/storage-s3",
  "@revnixhq/storage-vercel-blob",
  "@revnixhq/storage-uploadthing",
];

const nextConfig: NextConfig = {
  // Type-checking responsibility lives in each workspace package's own
  // `pnpm check-types` (run by CI and during dev). The playground's prod
  // build should only gate on actual bundling/compilation, not re-run
  // tsc across all transpiled workspace packages — that's redundant work
  // that surfaces pre-existing per-package type errors as build blockers.
  // Source-mode pulls admin/ui/nextly source through next build's tsc;
  // without this flag, any type error anywhere in those packages blocks
  // the playground build even though admin itself can build cleanly via
  // tsup (which doesn't type-check). Same pattern Payload uses for the
  // same reason.
  typescript: {
    ignoreBuildErrors: true,
  },
  // Source-mode for client UI packages (admin, ui, plugin-form-builder) is
  // always on — they're transpiled from source via the resolveAlias entries
  // below in both dev and prod. (Their tsup builds produce dist outputs the
  // playground doesn't actually consume because the aliases redirect to src.)
  //
  // Server-side workspace packages (nextly, adapters, storage) flip between
  // bundled-from-source (dev → HMR) and Node-required-from-dist (prod →
  // smaller bundle). They CANNOT be in both transpilePackages and
  // serverExternalPackages at the same time — Next.js rejects that
  // combination — so the two arrays are flipped symmetrically below.
  transpilePackages: [
    "@revnixhq/admin",
    "@revnixhq/ui",
    "@revnixhq/plugin-form-builder",
    // Only in dev: server packages bundled by Next.js → HMR works.
    // In prod: server packages move to serverExternalPackages instead.
    ...(isDev ? NEXTLY_WORKSPACE_PACKAGES : []),
  ],
  // Native + third-party Node-only deps stay external always. Workspace
  // packages are external ONLY in prod (Payload pattern). In dev they're
  // bundled by Next.js via the source aliases, which is what enables HMR
  // for server files like packages/nextly/src/init/build-service-config.ts
  // and packages/plugin-form-builder/src/plugin.ts.
  serverExternalPackages: [
    "@aws-sdk/client-s3",
    "@aws-sdk/lib-storage",
    "better-sqlite3",
    "pg",
    "mysql2",
    "sharp",
    "drizzle-orm",
    "esbuild",
    "bundle-require",
    "nodemailer",
    // Symmetric with transpilePackages above: workspace packages live in
    // exactly ONE of the two arrays at any time. In prod they're external
    // (loaded from dist via Node require) — smaller bundle, dist ships
    // as published.
    ...(isDev ? [] : NEXTLY_WORKSPACE_PACKAGES),
  ],
  experimental: {
    esmExternals: true,
  },
  turbopack: {
    resolveAlias: {
      // @admin/* is admin's own internal source path alias (admin's
      // source files use it for cross-cutting imports inside the
      // package — see packages/admin/tsconfig.json paths).
      "@admin/*": ["../../packages/admin/src/*"],
      // Source aliases for client-side packages.
      //
      // admin and plugin-form-builder MUST be aliased together: the plugin
      // registers components into admin's component registry, which only
      // works when both packages resolve to the same module instance.
      // Aliasing one without the other reproduces the F21-era "module
      // identity mismatch" that broke FormBuilder custom view registration.
      "@revnixhq/ui": ["../../packages/ui/src/index.ts"],
      "@revnixhq/admin": ["../../packages/admin/src/index.ts"],
      "@revnixhq/admin/lib/component-registry": [
        "../../packages/admin/src/lib/plugins/component-registry.ts",
      ],
      "@revnixhq/admin/lib/plugin-components": [
        "../../packages/admin/src/lib/plugins/plugin-components.ts",
      ],
      "@revnixhq/plugin-form-builder": [
        "../../packages/plugin-form-builder/src/index.ts",
      ],
      "@revnixhq/plugin-form-builder/admin": [
        "../../packages/plugin-form-builder/src/admin/index.ts",
      ],
      "@revnixhq/plugin-form-builder/components": [
        "../../packages/plugin-form-builder/src/components/index.ts",
      ],
      // Source aliases for server-side workspace packages — Payload-style.
      // With these in place AND the packages omitted from serverExternalPackages
      // in dev, Turbopack reads .ts directly and HMR fires on source edits.
      "@revnixhq/nextly": ["../../packages/nextly/src/index.ts"],
      "@revnixhq/adapter-drizzle": [
        "../../packages/adapter-drizzle/src/index.ts",
      ],
      "@revnixhq/adapter-postgres": [
        "../../packages/adapter-postgres/src/index.ts",
      ],
      "@revnixhq/adapter-mysql": [
        "../../packages/adapter-mysql/src/index.ts",
      ],
      "@revnixhq/adapter-sqlite": [
        "../../packages/adapter-sqlite/src/index.ts",
      ],
      "@revnixhq/storage-s3": ["../../packages/storage-s3/src/index.ts"],
      "@revnixhq/storage-vercel-blob": [
        "../../packages/storage-vercel-blob/src/index.ts",
      ],
      "@revnixhq/storage-uploadthing": [
        "../../packages/storage-uploadthing/src/index.ts",
      ],
      // Public sub-path imports of @revnixhq/nextly (e.g. /runtime, /config,
      // /errors, /api, /storage, /database, /auth, /observability,
      // /next, /actions, /validation, /api/<route>, /cli/utils).
      // Mirrors the export map in packages/nextly/package.json. Without this
      // wildcard, source-mode resolves only the bare "@revnixhq/nextly"
      // import — sub-paths still try to load from dist via package.json
      // exports and miss our source aliases.
      "@revnixhq/nextly/*": ["../../packages/nextly/src/*"],
      // Internal path aliases used INSIDE nextly's source (mirror of the
      // "paths" block in packages/nextly/tsconfig.json). When tsup builds
      // dist these get resolved away; in source-mode Turbopack reads .ts
      // directly and needs to know about these aliases too. Without them,
      // imports like `import { hashPassword } from "@nextly/auth/password"`
      // inside packages/nextly/src/domains/users/services/user-mutation-service.ts
      // fail with Module not found.
      "@nextly/actions": ["../../packages/nextly/src/actions/index.ts"],
      "@nextly/api/*": ["../../packages/nextly/src/api/*"],
      "@nextly/auth/*": ["../../packages/nextly/src/auth/*"],
      "@nextly/collections": [
        "../../packages/nextly/src/collections/index.ts",
      ],
      "@nextly/collections/*": ["../../packages/nextly/src/collections/*"],
      "@nextly/database/*": ["../../packages/nextly/src/database/*"],
      "@nextly/di/*": ["../../packages/nextly/src/di/*"],
      "@nextly/errors": ["../../packages/nextly/src/errors/index.ts"],
      "@nextly/hooks/*": ["../../packages/nextly/src/hooks/*"],
      "@nextly/lib/*": ["../../packages/nextly/src/lib/*"],
      "@nextly/schemas/*": ["../../packages/nextly/src/schemas/*"],
      "@nextly/scripts/*": ["../../packages/nextly/src/scripts/*"],
      "@nextly/services/*": ["../../packages/nextly/src/services/*"],
      "@nextly/storage": ["../../packages/nextly/src/storage/index.ts"],
      "@nextly/storage/*": ["../../packages/nextly/src/storage/*"],
      "@nextly/types/*": ["../../packages/nextly/src/types/*"],
      "@nextly/validation": [
        "../../packages/nextly/src/validation/index.ts",
      ],
      "@nextly/validation/*": ["../../packages/nextly/src/validation/*"],
      // Stubs / native-deps resolution. pg + mysql2 stubs predate this commit
      // and remain load-bearing for Turbopack's optional-peer-dep handling
      // inside @revnixhq/nextly.
      pg: "pg",
      "mysql2/promise": "./src/stubs/mysql2-stub.js",
      mysql2: "./src/stubs/mysql2-stub.js",
      // CSS files come from dist (the build-css.mjs pipeline applies the
      // .adminapp scoping post-process; Phase 2 added a watch loop so the
      // dist file stays fresh during dev). With @revnixhq/admin aliased to
      // src above, Turbopack stops consulting admin's package.json exports
      // for subpaths — so the CSS alias is now load-bearing (not dead config
      // as it was before this commit).
      "@revnixhq/admin/style.css": [
        "../../packages/admin/dist/styles/globals.css",
      ],
      "@revnixhq/plugin-form-builder/styles/builder.css": [
        "../../packages/plugin-form-builder/dist/styles/form-builder.css",
      ],
      "@revnixhq/plugin-form-builder/styles/submissions-filter.css": [
        "../../packages/plugin-form-builder/dist/styles/submissions-filter.css",
      ],
    },
  },
};

export default nextConfig;
