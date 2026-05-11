// Doctor: pre-flight checks for the playground dev experience.
// Each check returns { ok: true } or { ok: false, reason, fix }.
// Intentionally JS (.mjs) — kept dependency-free so it can run before
// any TypeScript or Next.js machinery loads.

import * as fs from "node:fs/promises";
import * as net from "node:net";
import * as path from "node:path";

// Workspace integrity check. The two scopes get hoisted differently:
//   - @nextlyhq/* — consumed by the root package.json (eslint, prettier
//     configs) and by other packages, so they appear at <root>/node_modules.
//   - @nextlyhq/* — consumed by the playground app and internally between
//     packages, but never directly by the root, so the actual symlinks
//     live in <root>/apps/playground/node_modules. This is the layer
//     that broke during the @nextly→@nextlyhq rebrand.
// Checking both locations catches the failure modes that actually occur.
const REQUIRED_LOCATIONS = [
  { scope: "@nextlyhq", relativePath: "node_modules" },
  { scope: "@nextlyhq", relativePath: "apps/playground/node_modules" },
];

export async function checkWorkspaceLinks(nextlyRoot) {
  const missing = [];
  for (const { scope, relativePath } of REQUIRED_LOCATIONS) {
    const scopeDir = path.join(nextlyRoot, relativePath, scope);
    try {
      const entries = await fs.readdir(scopeDir);
      if (entries.length === 0) missing.push(`${relativePath}/${scope}`);
    } catch {
      missing.push(`${relativePath}/${scope}`);
    }
  }
  if (missing.length === 0) return { ok: true };

  return {
    ok: false,
    reason: `workspace symlinks missing for: ${missing.join(", ")}`,
    fix: [
      "Try in order:",
      "  1. pnpm install --force",
      "  2. rm -rf node_modules packages/*/node_modules apps/*/node_modules && pnpm install",
      "  3. yalc remove --all (if you've used yalc recently in this directory)",
    ].join("\n"),
  };
}

export async function checkEnvFile(envPath) {
  try {
    await fs.access(envPath);
    return { ok: true };
  } catch {
    // .env missing. Try auto-creating from .env.example. The example is
    // a checked-in template with safe defaults (SQLite, dev secrets), so
    // copying it during a fresh-clone boot is the right default. If even
    // the example is missing, surface a real failure.
    const exampleSibling = envPath.replace(/\.env$/, ".env.example");
    try {
      await fs.access(exampleSibling);
      await fs.copyFile(exampleSibling, envPath);
      return { ok: true, autoCreated: true, copiedFrom: exampleSibling };
    } catch {
      return {
        ok: false,
        reason: `.env missing at ${envPath} and .env.example missing as well`,
        fix: `create ${envPath} manually with DB_DIALECT, DATABASE_URL, NEXTLY_SECRET, NEXT_PUBLIC_APP_URL`,
      };
    }
  }
}

// Detects whether workspace packages have been built. The seed sub-process
// imports compiled dist outputs (e.g. @nextlyhq/adapter-drizzle's
// version-check.cjs), so a fresh clone with no `pnpm build` will crash the
// seed step. Using packages/nextly/dist as the sentinel because it is the
// last package built in the turbo graph -- if it exists, the whole
// dependency chain compiled.
export async function checkBuildArtifacts(nextlyRoot) {
  const sentinel = path.join(nextlyRoot, "packages", "nextly", "dist");
  try {
    const entries = await fs.readdir(sentinel);
    if (entries.length === 0) {
      return {
        ok: false,
        reason: "packages/nextly/dist is empty (workspace not built yet)",
        fix: "pnpm turbo build --filter='./packages/*'",
      };
    }
    return { ok: true };
  } catch {
    return {
      ok: false,
      reason: "packages/nextly/dist missing (workspace not built yet)",
      fix: "pnpm turbo build --filter='./packages/*'",
    };
  }
}

// NOTE: this is a TOCTOU check by design — between the time we close
// the test listener and `next dev` calls bind, another process could
// grab the port. The point is to catch the obvious case ("port already
// busy when we start") with a clear message; the truly racy edge falls
// through to next dev's own EADDRINUSE error.
export async function checkPort(port) {
  return new Promise(resolve => {
    const server = net.createServer();
    server.once("error", () => {
      resolve({
        ok: false,
        reason: `port ${port} is in use`,
        fix: `PORT=${port + 1} pnpm dev:app`,
      });
    });
    server.once("listening", () => {
      server.close(() => resolve({ ok: true }));
    });
    server.listen(port);
  });
}

// Run all standard checks and return a composite result. Used by both the
// wrapper script and the standalone `pnpm dev:doctor` entry.
export async function runAllChecks({ nextlyRoot, envPath, port }) {
  const results = {
    workspaceLinks: await checkWorkspaceLinks(nextlyRoot),
    envFile: await checkEnvFile(envPath),
    buildArtifacts: await checkBuildArtifacts(nextlyRoot),
    port: await checkPort(port),
  };
  const ok = Object.values(results).every(r => r.ok);
  return { ok, results };
}

// CLI entry: when invoked directly (pnpm dev:doctor), print a report.
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  const here = path.dirname(new URL(import.meta.url).pathname);
  const nextlyRoot = path.resolve(here, "..");
  const envPath = path.join(nextlyRoot, "apps", "playground", ".env");
  const port = Number(process.env.PORT) || 3000;

  const { ok, results } = await runAllChecks({ nextlyRoot, envPath, port });
  for (const [name, r] of Object.entries(results)) {
    if (r.ok) {
      console.log(`[nextly] ✓ ${name}`);
    } else {
      console.error(`[nextly] ✗ ${name}: ${r.reason}`);
      console.error(`         ${r.fix.replace(/\n/g, "\n         ")}`);
    }
  }
  process.exit(ok ? 0 : 1);
}
