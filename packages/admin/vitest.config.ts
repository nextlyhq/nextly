import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "module";
import path from "path";

import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

// Mirror the tsup `define` so `adminVersion()` resolves under test.
const require = createRequire(import.meta.url);
const { version: adminVersion } = require("./package.json") as {
  version: string;
};

/**
 * A test file that touches the DOM, read from its source when the config loads.
 *
 * jsdom is built afresh for every file it runs, and that is about a third of
 * this suite's time. A `.ts` or `.mjs` file naming none of these runs on the
 * `node` environment instead, without the DOM setup file. A word matched by
 * accident only keeps a file on jsdom, which is where it ran before.
 */
const TOUCHES_DOM =
  /\b(?:document|window|navigator|localStorage|sessionStorage|location|history|HTMLElement|Element|Node|DOMParser|render|renderHook|screen|matchMedia|ResizeObserver|IntersectionObserver|MutationObserver|requestAnimationFrame|Event|CustomEvent|KeyboardEvent|MouseEvent|getComputedStyle|innerHTML|EventSource|BroadcastChannel|Blob|File|FileReader|FormData|URL\.createObjectURL|jsdom)\b|@testing-library\//;

/** The test files that run without a DOM, relative to this folder. */
function filesWithoutDom(): string[] {
  return ["src", "scripts"]
    .flatMap(root =>
      readdirSync(path.join(__dirname, root), { recursive: true }).map(entry =>
        path.join(root, String(entry)).split(path.sep).join("/")
      )
    )
    .filter(
      file =>
        /\.test\.(?:ts|mjs)$/.test(file) &&
        !TOUCHES_DOM.test(readFileSync(path.join(__dirname, file), "utf8"))
    );
}

const nodeFiles = filesWithoutDom();

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  define: {
    __NEXTLY_ADMIN_VERSION__: JSON.stringify(adminVersion),
  },
  test: {
    // What each file loaded on its last run, so `--changed` and `related` pick
    // tests from real dependencies rather than a static import graph.
    experimental: { recordDependencies: true },
    globals: true,

    // scripts/ too: the CSS scoper decides whether the admin's styles stay off
    // the host page, and it shipped a broken keyframe for want of a test.
    // Inline projects inherit everything here and merge their arrays into it,
    // so `include` and `setupFiles` are per project.
    projects: [
      {
        extends: true,
        test: {
          name: "admin",
          environment: "jsdom",
          setupFiles: ["./src/__tests__/setup.ts"],
          include: [
            "src/**/*.test.tsx",
            "src/**/*.test.ts",
            "scripts/**/*.test.mjs",
          ],
          exclude: nodeFiles,
          // One project at a time, so the workers `local-limits` sized for are
          // the only ones running.
          sequence: { groupOrder: 0 },
        },
      },
      {
        extends: true,
        test: {
          name: "admin (node)",
          environment: "node",
          include: nodeFiles,
          sequence: { groupOrder: 1 },
        },
      },
    ],
    exclude: ["node_modules", "dist", ".turbo", "**/*.d.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html", "lcov"],
      exclude: [
        "node_modules/",
        "dist/",
        "**/*.test.{ts,tsx}",
        "**/*.spec.{ts,tsx}",
        "**/index.{ts,tsx}",
        "**/types.ts",
        "src/pages/**", // Exclude page files for now
      ],
      thresholds: {
        lines: 40,
        functions: 40,
        branches: 40,
        statements: 40,
      },
    },
    testTimeout: 10000,
  },
});
