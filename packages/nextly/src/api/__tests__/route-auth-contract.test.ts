/**
 * Source-level auth contract for the standalone `nextly/api/*` handlers.
 *
 * Every `./api/*` subpath in package.json is a route surface consumer apps
 * wire onto their public REST API, so each exported HTTP handler must gate
 * through a verified-authentication path (the `route-auth` helpers or the
 * middleware's `requireAuthentication`) or be explicitly allowlisted as
 * public. A presence-only Authorization-header check is not authentication;
 * this suite exists so that pattern can never quietly return.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const PKG_ROOT = join(__dirname, "..", "..", "..");
const SRC_DIR = join(PKG_ROOT, "src");

/**
 * Handlers that are deliberately public, with the reason on record.
 * Anything not listed here must authenticate.
 */
const PUBLIC_ALLOWLIST = new Set<string>([
  // Health probe for monitoring; returns no privileged detail by design.
  "api/health.ts:GET",
  "api/health.ts:HEAD",
  // Single *content* reads serve public frontends (e.g. site settings);
  // the PATCH and schema handlers on the same file authenticate.
  "api/singles-detail.ts:GET",
]);

/**
 * Files whose auth model lives outside the per-handler pattern this test
 * scans for, each verified by its own mechanism.
 */
const SELF_AUTHENTICATING = new Set<string>([
  // Factory API: createMediaHandlers gates every parsed route through
  // requirePermission / its public-reads-only mount model.
  "api/media-handlers.ts",
  // Verifies the access-token JWT directly and 401s anything short of a
  // valid session; exists to report auth/account state.
  "api/auth-state.ts",
]);

function apiSubpathFiles(): string[] {
  const pkg = JSON.parse(
    readFileSync(join(PKG_ROOT, "package.json"), "utf8")
  ) as { exports: Record<string, unknown> };
  return Object.keys(pkg.exports)
    .filter(k => k.startsWith("./api/"))
    .map(k => `api/${k.slice("./api/".length)}.ts`);
}

describe("api route auth contract", () => {
  it("exposes only files that exist as api subpaths", () => {
    for (const file of apiSubpathFiles()) {
      expect(
        () => readFileSync(join(SRC_DIR, file), "utf8"),
        `${file} is exported but missing`
      ).not.toThrow();
    }
  });

  it("no exported api module references a presence-only header gate", () => {
    for (const file of apiSubpathFiles()) {
      const src = readFileSync(join(SRC_DIR, file), "utf8");
      expect(src, `${file} references requireAuthHeader`).not.toContain(
        "requireAuthHeader"
      );
    }
  });

  it("every exported HTTP handler authenticates or is allowlisted public", () => {
    const verbs = ["GET", "POST", "PATCH", "PUT", "DELETE", "HEAD"] as const;
    const offenders: string[] = [];

    for (const file of apiSubpathFiles()) {
      if (SELF_AUTHENTICATING.has(file)) continue;
      const src = readFileSync(join(SRC_DIR, file), "utf8");

      for (const verb of verbs) {
        const marker = `export const ${verb} = withErrorHandler(`;
        const start = src.indexOf(marker);
        if (start === -1) continue;

        // The handler body runs until the next exported handler (or EOF).
        const nextExport = src.indexOf(
          "\nexport const ",
          start + marker.length
        );
        const body = src.slice(
          start,
          nextExport === -1 ? undefined : nextExport
        );

        const key = `${file}:${verb}`;
        const authenticates =
          body.includes("requireRoute") ||
          body.includes("requireAuthentication(");
        if (!authenticates && !PUBLIC_ALLOWLIST.has(key)) {
          offenders.push(key);
        }
      }
    }

    expect(
      offenders,
      `handlers without a verified auth gate: ${offenders.join(", ")}`
    ).toEqual([]);
  });
});
