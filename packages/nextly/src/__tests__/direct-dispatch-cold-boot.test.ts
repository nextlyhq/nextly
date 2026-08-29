/**
 * Every direct-dispatch branch is in the cold-boot list.
 *
 * `DIRECT_DISPATCH_SERVICES` exists because those handlers return BEFORE the
 * shared dispatcher path that initialises services. Its docblock already warned
 * that "a service added there without being added here silently loses cold-boot
 * initialisation" — and the warning did not hold: `jobs` was added as a branch
 * and omitted from the list, so on a cold serverless instance a valid scheduler
 * request reached the handler with no initialised runtime.
 *
 * A comment cannot enforce that. This reads the two out of the source and makes
 * the drift a failing test instead — for every service, not just the one that
 * happened to be caught in review.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(
  fileURLToPath(new URL("../routeHandler.ts", import.meta.url)),
  "utf8"
);

/** The service names the file's own `DIRECT_DISPATCH_SERVICES` set lists. */
function declaredServices(): string[] {
  const block =
    /const DIRECT_DISPATCH_SERVICES = new Set<string>\(\[([\s\S]*?)\]\)/.exec(
      SOURCE
    );
  expect(block, "the set moved or was renamed").not.toBeNull();
  return [...(block?.[1] ?? "").matchAll(/"([^"]+)"/g)].map(
    m => m[1] as string
  );
}

/**
 * The service names the file directly dispatches.
 *
 * Scoped to the text AFTER the `DIRECT_DISPATCH_SERVICES.has(service)` guard,
 * which is the boundary the file itself draws: everything past it returns
 * without reaching the shared dispatcher. `service === "x"` also appears far
 * earlier, in permission resolution, for services that DO go through the
 * dispatcher and correctly are not in the set — a scan of the whole file reads
 * those as missing entries and fails for a reason that is not a defect.
 */
function dispatchedServices(): string[] {
  const guard = SOURCE.indexOf("DIRECT_DISPATCH_SERVICES.has(service)");
  expect(guard, "the cold-boot guard moved or was renamed").toBeGreaterThan(-1);
  const region = SOURCE.slice(guard);
  return [...region.matchAll(/\bservice === "([^"]+)"/g)].map(
    m => m[1] as string
  );
}

describe("direct dispatch and cold-boot initialisation", () => {
  it("finds both lists, so an empty comparison cannot pass vacuously", () => {
    // The control. Two regexes that matched nothing would agree perfectly and
    // report the strongest possible green about a file they never read.
    expect(declaredServices().length).toBeGreaterThan(5);
    expect(dispatchedServices().length).toBeGreaterThan(5);
    // And the region really is a region: a boundary at the very end of the file
    // would yield an empty scan that agrees with anything.
    expect(dispatchedServices()).toContain("webhooks");
  });

  it("lists every directly dispatched service for cold-boot initialisation", () => {
    const declared = new Set(declaredServices());
    const missing = dispatchedServices().filter(name => !declared.has(name));

    expect(missing).toEqual([]);
  });
});
