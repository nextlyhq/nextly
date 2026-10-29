import fs from "fs";
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";

import { defineConfig, type Rolldown } from "tsdown";

// ESM __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read at build time so `adminVersion()` can name the release this bundle was
// published in. The browser bundle has no module resolver to read it later.
const require = createRequire(import.meta.url);
const { version: ADMIN_VERSION } = require("./package.json") as {
  version: string;
};

/**
 * Bundle size target in KB (minified, not gzipped)
 * Based on industry standards for comprehensive UI libraries:
 * - Chakra UI: ~89 KB gzipped (~300 KB minified)
 * - Material UI: ~93.7 KB gzipped (~350 KB minified)
 * - Our target: 2000 KB minified (larger due to bundling all deps)
 */
const BUNDLE_SIZE_TARGET_KB = 2000;

/**
 * Format byte size to KB with 2 decimal places
 */
function formatSizeKB(bytes: number): string {
  return (bytes / 1024).toFixed(2);
}

/**
 * External Dependencies - packages that should NOT be bundled
 * These must match the user's installed versions
 */
const EXTERNAL_DEPS = [
  "react",
  "react-dom",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
  "next",
  "next/navigation",
  "next/link",
  "next/image",
  "@tanstack/react-query",
  // Note: prismjs is bundled (not external) - the post-build step fixes the dynamic require issue
];

/**
 * Internal Dependencies - packages that SHOULD be bundled
 * This avoids requiring users to install dozens of UI libraries
 */
const NO_EXTERNAL_DEPS = [
  // Radix UI primitives
  /@radix-ui\/.*/,
  // Lexical rich text editor
  /lexical/,
  /@lexical\/.*/,
  // CodeMirror code editor
  /@codemirror\/.*/,
  /@uiw\/.*/,
  // DnD Kit for drag and drop
  /@dnd-kit\/.*/,
  // Form handling
  /@hookform\/.*/,
  "react-hook-form",
  "zod",
  // UI utilities
  "class-variance-authority",
  "clsx",
  "tailwind-merge",
  "tailwind-variants",
  "tailwindcss-animate",
  "cmdk",
  "lucide-react",
  "sonner",
  "next-themes",
  "react-dropzone",
  // Table
  "@tanstack/react-table",
  // shadcn
  "@shadcn/ui",
];

/**
 * A stylesheet a component imports resolves to an empty module.
 *
 * The admin's stylesheet is published by `build-css.mjs` as `./style.css`,
 * compiled by Tailwind; the import in a component carries no code for the
 * bundle. Resolved to an id that does not end in `.css`, so it is neither
 * bundled as CSS nor refused for lacking a CSS pipeline.
 */
const EMPTY_STYLESHEET = "\0nextly:empty-stylesheet";
const stylesheetImportsAreEmpty: Rolldown.Plugin = {
  name: "nextly:empty-stylesheet",
  resolveId: {
    order: "pre",
    filter: { id: /\.css$/ },
    handler: () => EMPTY_STYLESHEET,
  },
  load: {
    filter: { id: /^\0nextly:empty-stylesheet$/ },
    handler: () => ({ code: "", moduleSideEffects: false }),
  },
};

/** Whether an import names a listed package, or a subpath of one. */
function matches(id: string, patterns: readonly (string | RegExp)[]): boolean {
  return patterns.some(pattern =>
    typeof pattern === "string"
      ? id === pattern || id.startsWith(`${pattern}/`)
      : pattern.test(id)
  );
}

/** Where the admin's pages live; a chunk whose entry is one of them is a route. */
const PAGES_DIR = `${path.join(__dirname, "src", "pages")}${path.sep}`;

/**
 * A chunk's file name: `page.<path under src/pages>-<hash>.mjs` for a lazily
 * loaded page, the default `[name]-[hash].mjs` for anything else.
 */
function pageChunkFileName(facadeModuleId: string | null): string {
  if (!facadeModuleId?.startsWith(PAGES_DIR)) return "[name]-[hash].mjs";
  const page = facadeModuleId
    .slice(PAGES_DIR.length)
    .replace(/\.(tsx?|jsx?)$/, "")
    .split(path.sep)
    .join(".")
    .replace(/[^\w.-]/g, "_");
  return `page.${page}-[hash].mjs`;
}

export default defineConfig([
  // Main admin bundle - ESM only due to top-level await in Lexical
  // Note: CSS is built separately by scripts/build-css.mjs using Tailwind CLI
  {
    entry: [
      "src/index.ts",
      "src/lib/plugins/component-registry.ts",
      "src/lib/plugins/plugin-components.ts",
    ],
    format: ["esm"],
    outDir: "dist",
    // tsdown cleans the directory once, before either config builds, so the
    // CLI bundle written beside this one survives it.
    clean: true,
    sourcemap: false,
    target: "es2022",
    // oxc writes the declarations from the source's own annotations, one file
    // at a time. Named, because the plugin otherwise picks `tsc` (or `tsgo` under
    // TypeScript 7) when `isolatedDeclarations` is off in tsconfig.json, and it
    // is off here: admin's `paths` reach nextly's source, which the flag would
    // hold to it too. An export oxc cannot type fails this build.
    dts: { generator: "oxc", sourcemap: false },
    tsconfig: "tsconfig.json",
    define: {
      __NEXTLY_ADMIN_VERSION__: JSON.stringify(ADMIN_VERSION),
      // The bundler folds `process.env.NODE_ENV` at build time, and tsup's
      // fallback for an unset NODE_ENV was "development", so without an explicit value
      // the published dist is a development build. The outcome that matters:
      // the error screens' "View technical details" box — the caught error's
      // message and stack trace — renders under `NODE_ENV === "development"`,
      // and folding production here is what keeps it out of what production
      // users are served. An explicit define with a production default keeps
      // that decision with the repository; a build that deliberately wants
      // dev behavior sets NODE_ENV=development itself. Whether the
      // development reload stream opens is the running server's call, not
      // this define's: the client subscribes only on the server's explicit yes.
      "process.env.NODE_ENV": JSON.stringify(
        process.env.NODE_ENV ?? "production"
      ),
    },
    deps: {
      neverBundle: id => matches(id, EXTERNAL_DEPS),
      alwaysBundle: id => matches(id, NO_EXTERNAL_DEPS),
      // The declarations name the packages their types come from rather than
      // inlining them, bundled into the JavaScript or not. `@admin/*` is this
      // package's own source under a path alias, so it is resolved and bundled.
      //
      // Rolldown asks this again with each RESOLVED id, a file path. A Windows
      // path starts with a drive letter, which the package-name test accepts,
      // and a source file marked external binds the declarations to the
      // JavaScript module, where no type is exported. `path.win32` treats both
      // `D:\…` and `/…` as absolute, so a path is never a package on any OS.
      dts: {
        neverBundle: id =>
          !path.win32.isAbsolute(id) &&
          /^(@[\w-][\w.-]*\/)?[\w-]/.test(id) &&
          !id.startsWith("@admin/"),
      },
    },
    treeshake: {
      // `console.debug` calls are dropped from the bundle.
      manualPureFunctions: ["console.debug"],
    },
    // Platform browser to avoid Node.js-specific require patterns
    platform: "browser",
    // Resolve the browser builds of dependencies, as ES modules, so the
    // bundle carries no Node-specific `require` patterns.
    inputOptions: {
      resolve: {
        mainFields: ["module", "main"],
        conditionNames: ["import", "module", "browser", "default"],
      },
    },
    // CRITICAL: Alias use-sync-external-store/shim to our React re-export
    // The original shim has polyfill code that doesn't work with React 19's changed internals
    // By aliasing to our shim, we use React's built-in useSyncExternalStore
    alias: {
      "use-sync-external-store/shim": path.resolve(
        __dirname,
        "src/shims/use-sync-external-store-shim.ts"
      ),
      "use-sync-external-store/shim/index.js": path.resolve(
        __dirname,
        "src/shims/use-sync-external-store-shim.ts"
      ),
      "use-sync-external-store": path.resolve(
        __dirname,
        "src/shims/use-sync-external-store-shim.ts"
      ),
    },
    minify: true,
    // A lazily loaded page's chunk is named after its source path
    // (`page.dashboard.users.create-<hash>.mjs`) rather than its file name,
    // which many pages share (`index`, `create`, `[id]`). The bundle budgets
    // pin each route by this name, so it has to be unique and survive a
    // rebuild; every other chunk keeps the default name.
    outputOptions: {
      chunkFileNames: chunk => pageChunkFileName(chunk.facadeModuleId),
    },
    plugins: [stylesheetImportsAreEmpty],
    onSuccess: () => {
      const distDir = path.join(process.cwd(), "dist");

      if (!fs.existsSync(distDir)) {
        console.warn("⚠️  Dist directory not found");
        return;
      }

      // CRITICAL: Add "use client" directive to ALL JS output files
      // This is required for React Server Components to work correctly
      // The admin package is entirely client-side (uses hooks, state, etc.)
      // We do this in onSuccess because banner doesn't work with splitting:true

      // Recursively find all .mjs and .cjs files in dist directory
      const findJsFiles = (dir: string): string[] => {
        const files: string[] = [];
        const entries = fs.readdirSync(dir, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            files.push(...findJsFiles(fullPath));
          } else if (
            entry.name.endsWith(".mjs") ||
            entry.name.endsWith(".cjs")
          ) {
            files.push(fullPath);
          }
        }

        return files;
      };

      const jsFiles = findJsFiles(distDir);

      const USE_CLIENT_DIRECTIVE = '"use client";\n';

      console.log("\n📦 Adding 'use client' directive to output files...");

      for (const filePath of jsFiles) {
        const relativePath = path.relative(distDir, filePath);
        let content = fs.readFileSync(filePath, "utf-8");
        let modified = false;

        // CRITICAL FIX: Replace CJS interop helpers to avoid Turbopack detection
        // Turbopack detects patterns like `typeof require` and replaces them with
        // its own requireStub that throws "dynamic usage of require is not supported"
        // We must completely eliminate these patterns from the output

        // Pattern 1: The complex CJS helper with Proxy and require checks
        // This is generated by esbuild for CJS interop
        // Replace with a no-op function that returns an empty object when called
        // IMPORTANT: Don't invoke it - keep it as a function since _noop is called elsewhere
        const cjsHelperRegex =
          /\(e=>"undefined"!=typeof require\?require:"undefined"!=typeof Proxy\?new Proxy\(e,\{get:\(e,r\)=>\("undefined"!=typeof require\?require:e\)\[r\]\}\):e\)\(function\(e\)\{[^}]+\}\)/g;
        if (cjsHelperRegex.test(content)) {
          content = content.replace(cjsHelperRegex, "(()=>({}))");
          modified = true;
          console.log(`  Replaced CJS helper pattern in ${relativePath}`);
        }

        // Pattern 2: Rename __require to _noop to avoid Turbopack detection
        if (content.includes("__require")) {
          content = content.replace(/__require/g, "_noop");
          modified = true;
          console.log(`  Renamed __require to _noop in ${relativePath}`);
        }

        // Pattern 3: Remove ALL "typeof require" checks that Turbopack detects
        // These patterns trigger Turbopack's CJS interop replacement
        const typeofRequirePatterns = [
          /"undefined"!=typeof require/g,
          /typeof require!=="undefined"/g,
          /typeof require==="undefined"/g,
          /"undefined"==typeof require/g,
        ];
        for (const pattern of typeofRequirePatterns) {
          if (pattern.test(content)) {
            content = content.replace(pattern, "false");
            modified = true;
            console.log(`  Removed typeof require check in ${relativePath}`);
          }
        }

        // Pattern 4: Remove require.apply patterns
        if (content.includes("require.apply")) {
          content = content.replace(
            /require\.apply\(this,arguments\)/g,
            "({})"
          );
          modified = true;
          console.log(`  Replaced require.apply in ${relativePath}`);
        }

        // Add "use client" directive if not present.
        // Skip files with a shebang (CLIs run in Node — "use client" would
        // displace the shebang and break executability via pkg.bin).
        if (!content.startsWith("#!") && !content.startsWith('"use client"')) {
          content = USE_CLIENT_DIRECTIVE + content;
          modified = true;
        }

        if (modified) {
          fs.writeFileSync(filePath, content);
        }
      }

      console.log(
        `✅ Added 'use client' directive to ${jsFiles.length} files\n`
      );

      // Bundle size analysis (only in CI or when ANALYZE=true)
      if (process.env.ANALYZE !== "true" && !process.env.CI) {
        return;
      }

      console.log("📊 Bundle Size Report:");
      console.log("=".repeat(60));

      let totalSize = 0;

      jsFiles.forEach((file: string) => {
        // file is already an absolute path from findJsFiles()
        const stats = fs.statSync(file);
        const sizeKB = formatSizeKB(stats.size);
        totalSize += stats.size;
        console.log(`${file.padEnd(40)} ${sizeKB.padStart(10)} KB`);
      });

      const totalSizeKB = formatSizeKB(totalSize);

      console.log("=".repeat(60));
      console.log(`Total Bundle Size: ${totalSizeKB} KB`);
      console.log(
        `Target: ${BUNDLE_SIZE_TARGET_KB} KB | Current: ${totalSizeKB} KB`
      );

      const totalSizeNum = parseFloat(totalSizeKB);
      if (totalSizeNum > BUNDLE_SIZE_TARGET_KB) {
        const excess = (totalSizeNum - BUNDLE_SIZE_TARGET_KB).toFixed(2);
        console.log(
          `⚠️  Bundle exceeds ${BUNDLE_SIZE_TARGET_KB}KB target by ${excess} KB`
        );
      } else {
        console.log(`✅ Bundle is under ${BUNDLE_SIZE_TARGET_KB}KB target!`);
      }
      console.log("=".repeat(60) + "\n");
    },
    // Keep the file names the exports map already publishes.
    outExtensions() {
      return { js: ".mjs", dts: ".d.ts" };
    },
  },
  // CLI bundle - can use CJS since it doesn't depend on Lexical
  {
    entry: ["src/cli.ts"],
    format: ["cjs", "esm"],
    outDir: "dist",
    sourcemap: false,
    target: "es2020",
    clean: false,
    // oxc, for the reason given on the browser bundle above.
    dts: { generator: "oxc", sourcemap: false },
    tsconfig: "tsconfig.json",
    deps: { neverBundle: id => matches(id, EXTERNAL_DEPS) },
    // Keep the file names the exports map already publishes.
    outExtensions({ format }) {
      return format === "cjs"
        ? { js: ".cjs", dts: ".d.cts" }
        : { js: ".mjs", dts: ".d.ts" };
    },
    // CommonJS stays published beside ESM; tsdown's hint to drop it is noise here.
    checks: { legacyCjs: false },
    cjsDefault: false,
  },
]);
