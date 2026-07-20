import { defineConfig } from "tsup";

const external = [
  "react",
  "react-dom",
  "lucide-react",
  "sonner",
  "cmdk",
  /^@radix-ui\//,
];

/**
 * Built separately from the component bundle, and after it: the two must not
 * emit into `dist` concurrently, because the component config cleans the
 * directory and races this entry's declaration output away.
 */
export default defineConfig({
  // Consumed by build tooling (a Tailwind config), never rendered, so it must
  // not carry the client directive the component bundle needs.
  entry: ["src/tailwind-preset.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: false,
  sourcemap: true,
  treeshake: true,
  external,
  outExtension({ format }) {
    return { js: format === "cjs" ? ".cjs" : ".mjs" };
  },
});
