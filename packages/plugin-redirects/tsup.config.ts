import { defineConfig } from "tsup";

export default defineConfig({
  // Two entries: the `.` plugin (Next-free, safe to import in nextly.config.ts)
  // and the `./middleware` Next.js helper (imports next/server).
  entry: ["src/index.ts", "src/middleware.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  minify: false,
  target: "es2022",
  external: ["next", "next/server"],
});
