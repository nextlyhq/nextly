import type { NextConfig } from "next";

// Dev playground for the plugin. The plugin's own source (../src) is aliased and
// transpiled so editing it hot-reloads. `nextly` + the admin come from
// node_modules (real deps). Node-only / dynamically-imported packages stay
// external (Turbopack can't bundle them).
const nextConfig: NextConfig = {
  typescript: { ignoreBuildErrors: true },
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
  turbopack: {
    resolveAlias: {
      // Map the package name to its source so HMR works without a build step.
      "{{pluginName}}": ["./../src/index.ts"],
      "{{pluginName}}/admin": ["./../src/admin/index.ts"],
    },
  },
};

export default nextConfig;
