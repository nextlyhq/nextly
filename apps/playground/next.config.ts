import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Note: We only transpile @revnixhq/admin here. The nextly package is consumed
  // as a pre-built package from node_modules (linked via pnpm workspace).
  // This avoids Turbopack transpiling nextly's source files which can cause
  // issues with its URL polyfill handling server-side code.
  transpilePackages: ["@revnixhq/admin", "@revnixhq/ui"],
  serverExternalPackages: [
    "@revnixhq/nextly",
    "@revnixhq/adapter-drizzle",
    "@revnixhq/adapter-postgres",
    "@revnixhq/adapter-mysql",
    "@revnixhq/adapter-sqlite",
    "@aws-sdk/client-s3",
    "@aws-sdk/lib-storage",
    "better-sqlite3",
    "pg",
    "mysql2",
    "sharp",
    "drizzle-orm",
    "esbuild",
    "bundle-require",
  ],
  experimental: {
    esmExternals: true,
  },
  // Enable Turbopack (default in Next.js 16)
  turbopack: {
    resolveAlias: {
      // Path aliases for workspace packages (used when transpiling from source)
      // Note: We only alias @admin/* here. The nextly package is consumed
      // via node_modules (linked via pnpm workspace) which uses the built dist files.
      // This prevents Turbopack from trying to transpile nextly source files
      // which can cause issues with Node.js-specific code.
      "@admin/*": ["../../packages/admin/src/*"],
      // Source-mode for @revnixhq/ui: Turbopack reads .ts/.tsx directly so
      // edits to packages/ui/src/... live-reload in the playground without
      // waiting for tsup --watch to write dist.
      "@revnixhq/ui": ["../../packages/ui/src/index.ts"],
      // Turbopack does not honour serverExternalPackages for optional peer deps
      // that are dynamically imported inside @revnixhq/nextly dist. Alias them
      // to the installed package so Turbopack can resolve them at build time.
      pg: "pg",
      "mysql2/promise": "./src/stubs/mysql2-stub.js",
      mysql2: "./src/stubs/mysql2-stub.js",
      "@revnixhq/adapter-postgres": "@revnixhq/adapter-postgres",
      "@revnixhq/adapter-mysql": "@revnixhq/adapter-mysql",
      "@revnixhq/adapter-sqlite": "@revnixhq/adapter-sqlite",
      // NOTE: Do NOT alias @revnixhq/admin to source here.
      // plugin-form-builder is pre-built against the admin dist, so aliasing
      // admin to raw source causes a module identity mismatch and breaks
      // the FormBuilder custom view registration.
      // CSS files need to come from dist folder (built artifacts)
      "@revnixhq/admin/styles.css": [
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
