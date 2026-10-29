import type { NextConfig } from "next";

// Dev playground for the plugin. The plugin's own source (../src) is aliased and
// transpiled so editing it hot-reloads. `nextly` + the admin come from
// node_modules (real deps). Node-only / dynamically-imported packages stay
// external (Turbopack can't bundle them).
const nextConfig: NextConfig = {
  typescript: { ignoreBuildErrors: true },
  // Nextly does not support Cache Components yet; see the installation guide.
  cacheComponents: false,
  // Transpile the aliased plugin source so HMR fires on src/ edits.
  transpilePackages: ["{{pluginName}}"],
  serverExternalPackages: [
    "better-sqlite3",
    "drizzle-orm",
    "drizzle-kit",
    "esbuild",
    "bundle-require",
    "sharp",
    "@nextlyhq/adapter-drizzle",
    "@nextlyhq/adapter-sqlite",
  ],
  experimental: {
    // Next.js type-checks and loads its config through the project's own
    // TypeScript CLI rather than TypeScript's library API. That is the 16.4
    // default, stated here so it cannot change underneath: a TypeScript with no
    // library API (7.0) works only this way.
    useTypeScriptCli: true,
    // Turbopack's garbage collector removes cache entries nothing reaches any
    // more, so `.next` stops growing across dev sessions and builds. Off by
    // default in 16.4.
    turbopackGc: true,
  },
  turbopack: {
    resolveAlias: {
      // Map the package name to its source so HMR works without a build step.
      "{{pluginName}}": ["./../src/index.ts"],
      "{{pluginName}}/admin": ["./../src/admin/index.ts"],
    },
  },
};

export default nextConfig;
