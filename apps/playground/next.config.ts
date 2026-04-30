import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Source-mode is enabled for the client-side workspace packages
  // (@revnixhq/ui, @revnixhq/admin, @revnixhq/plugin-form-builder) — see
  // turbopack.resolveAlias below. transpilePackages tells Next.js to
  // run these packages' .ts/.tsx through its own transpiler on the way
  // in. Server-side packages (nextly + adapters + storage) stay in
  // serverExternalPackages and continue to be loaded by Node from dist;
  // their tsup --watch keeps dist fresh during dev. Node-only code in
  // nextly's runtime path can't be safely transpiled by Turbopack, so
  // this bimodal split is intentional.
  transpilePackages: [
    "@revnixhq/admin",
    "@revnixhq/ui",
    "@revnixhq/plugin-form-builder",
  ],
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
  turbopack: {
    resolveAlias: {
      // @admin/* is admin's own internal source path alias (admin's
      // source files use it for cross-cutting imports inside the
      // package — see packages/admin/tsconfig.json paths).
      "@admin/*": ["../../packages/admin/src/*"],
      // Source-mode for the client packages: Turbopack reads .ts/.tsx
      // directly so edits to their src/... live-reload via HMR without
      // waiting for tsup --watch to write dist.
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
      // Turbopack does not honour serverExternalPackages for optional peer
      // deps that are dynamically imported inside @revnixhq/nextly dist.
      // Alias them to the installed package so Turbopack can resolve them
      // at build time.
      pg: "pg",
      "mysql2/promise": "./src/stubs/mysql2-stub.js",
      mysql2: "./src/stubs/mysql2-stub.js",
      "@revnixhq/adapter-postgres": "@revnixhq/adapter-postgres",
      "@revnixhq/adapter-mysql": "@revnixhq/adapter-mysql",
      "@revnixhq/adapter-sqlite": "@revnixhq/adapter-sqlite",
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
