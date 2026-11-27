import { defineConfig } from "tsdown";

// Bundles every dep (posthog-node, conf, env-paths, picocolors) into the
// output so consumers (create-nextly-app, nextly) don't need to add them
// as runtime dependencies.
// `src/ci.ts` is its own entry (`@nextlyhq/telemetry/ci`) so a caller that
// only asks "is this CI?" loads that check and not the client.
// `src/settings-folder.ts` is one too (`@nextlyhq/telemetry/settings-folder`),
// for code that only needs the person's Nextly settings folder.
export default defineConfig({
  entry: ["src/index.ts", "src/ci.ts", "src/settings-folder.ts"],
  format: ["esm"],
  // Declarations without a type check: `check-types` is the type check.
  // oxc writes the declarations from the source's own annotations
  // (`isolatedDeclarations` in tsconfig.json). Named rather than left to the
  // plugin's choice, which picks `tsc` (or `tsgo` under TypeScript 7) without
  // saying so when the flag is off.
  dts: { generator: "oxc", sourcemap: false },
  clean: true,
  sourcemap: true,
  treeshake: true,
  target: "node18",
  platform: "node",
  deps: { alwaysBundle: [/(.*)/] },
  // Keep the file names the exports map already publishes.
  outExtensions() {
    return { js: ".mjs", dts: ".d.ts" };
  },
});
