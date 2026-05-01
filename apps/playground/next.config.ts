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
  // Source-mode for ALL workspace packages — both client UI (admin, ui,
  // plugin-form-builder) and server-side (nextly, adapters, storage).
  // Turbopack reads .ts/.tsx directly via the resolveAlias entries below.
  transpilePackages: [
    "@revnixhq/admin",
    "@revnixhq/ui",
    "@revnixhq/plugin-form-builder",
    ...NEXTLY_WORKSPACE_PACKAGES,
  ],
  // Native + third-party Node-only deps stay external always. Workspace packages
  // are external ONLY in prod (Payload pattern). In dev, they're bundled by
  // Next.js via the source aliases, which is what enables HMR for server files
  // like packages/nextly/src/init/build-service-config.ts and
  // packages/plugin-form-builder/src/plugin.ts.
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
