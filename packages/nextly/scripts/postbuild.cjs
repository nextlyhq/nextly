const { cpSync, existsSync } = require("fs");
const { join } = require("path");

// Copy migration files to dist after build
console.log("\nCopying migration files to dist...");
try {
  const rootDir = join(__dirname, "..");
  const postgresqlSrc = join(rootDir, "src/database/migrations/postgresql");
  const mysqlSrc = join(rootDir, "src/database/migrations/mysql");
  const sqliteSrc = join(rootDir, "src/database/migrations/sqlite");
  const postgresqlDest = join(rootDir, "dist/migrations/postgresql");
  const mysqlDest = join(rootDir, "dist/migrations/mysql");
  const sqliteDest = join(rootDir, "dist/migrations/sqlite");

  if (existsSync(postgresqlSrc)) {
    cpSync(postgresqlSrc, postgresqlDest, { recursive: true });
    console.log("PostgreSQL migrations copied");
  } else {
    console.warn("PostgreSQL migrations directory not found");
  }

  if (existsSync(mysqlSrc)) {
    cpSync(mysqlSrc, mysqlDest, { recursive: true });
    console.log("MySQL migrations copied");
  } else {
    console.warn("MySQL migrations directory not found");
  }

  if (existsSync(sqliteSrc)) {
    cpSync(sqliteSrc, sqliteDest, { recursive: true });
    console.log("SQLite migrations copied");
  } else {
    console.warn("SQLite migrations directory not found");
  }

  console.log("Migration files copied successfully\n");
} catch (error) {
  console.error("Failed to copy migration files:", error);
  process.exit(1);
}

// loadable in plain Node.js so the CLI, config loaders, and plugin
// authors can `import { ... } from "nextly"` without
// dragging Next.js subpaths into a Node-only context.
//
// `dist/index.mjs` itself shouldn't have any `import "next/..."` at
// module top-level (only inside dynamically-loaded chunks). The check
// below loads the file in plain Node and fails the build if the
// import-chain crashes — which is precisely the regression we want to
// catch before publishing.
console.log("Verifying root entry loads in plain Node.js...");
require("child_process").execFileSync(
  process.execPath,
  [
    "-e",
    "import('./dist/index.mjs').then(() => process.exit(0)).catch(e => { console.error('[build-guard] Root entry crashed at load time:', e.message); process.exit(1); });",
  ],
  { cwd: join(__dirname, ".."), stdio: "inherit" }
);
console.log("Root entry is Node-safe.\n");

// The client-safe entries (`clientEntries` in tsdown.config.ts) are imported by
// browser bundles, `nextly/config` among them. Their BUILT module graph is
// what a browser bundler reads, and it can reach a Node built-in that their
// source never imports: a chunk shared with a server entry carries that
// entry's imports. A browser bundler then refuses the whole page (Turbopack:
// "does not support external modules (request: node:module)"). So each
// client-safe entry's static chunk graph is walked here, and the build fails
// on any Node built-in it reaches.
console.log("Verifying client-safe entries reach no Node built-in...");
{
  const { readFileSync } = require("fs");
  const { builtinModules } = require("module");
  const { dirname, resolve } = require("path");
  const packageRoot = join(__dirname, "..");
  const config = readFileSync(join(packageRoot, "tsdown.config.ts"), "utf8");
  const listStart = config.indexOf("const clientEntries = [");
  const list = config.slice(listStart, config.indexOf("];", listStart));
  const sources = [...list.matchAll(/^\s*"(src\/[^"]+\.ts)",?$/gm)].map(
    match => match[1]
  );
  if (listStart === -1 || sources.length === 0) {
    console.error(
      "[build-guard] Could not read clientEntries from tsdown.config.ts."
    );
    process.exit(1);
  }
  const builtins = new Set(builtinModules);
  const isBuiltin = specifier =>
    specifier.startsWith("node:") || builtins.has(specifier.split("/")[0]);
  const failures = [];
  for (const source of sources) {
    const entry = join(
      packageRoot,
      "dist",
      source.replace(/^src\//, "").replace(/\.ts$/, ".mjs")
    );
    const seen = new Set();
    const queue = [[entry, [source]]];
    while (queue.length > 0) {
      const [file, trail] = queue.shift();
      if (seen.has(file)) continue;
      seen.add(file);
      const code = readFileSync(file, "utf8");
      // Static imports and re-exports only: what a bundler follows eagerly.
      for (const [, specifier] of code.matchAll(
        /^\s*(?:import|export)\s*(?:[^'"]*?\bfrom\s*)?["']([^"']+)["']/gm
      )) {
        if (specifier.startsWith(".")) {
          queue.push([
            resolve(dirname(file), specifier),
            [...trail, specifier],
          ]);
        } else if (isBuiltin(specifier)) {
          failures.push(
            `${source} reaches ${specifier} via ${trail.join(" > ")}`
          );
        }
      }
    }
  }
  if (failures.length > 0) {
    console.error("[build-guard] Client-safe entries reach Node built-ins:");
    for (const failure of failures) console.error(`  ${failure}`);
    process.exit(1);
  }
  console.log(
    `${sources.length} client-safe entries reach no Node built-in.\n`
  );
}
