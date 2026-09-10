/**
 * Each mount's pass is consulted at the point the request actually reaches it.
 *
 * Namespaced routes are matched BEFORE the built-in router, because they live
 * under `/plugins` where core serves nothing. Root routes are matched only
 * AFTER it has declined, so core always answers first and no list of reserved
 * prefixes has to be kept in step with the routes core adds later.
 *
 * That ordering is also what keeps the boot decision honest. Both passes can
 * initialise services, and asking the root pass early means a plugin declaring
 * `/collections/:id` runs database and plugin startup for every anonymous
 * request to core's own `/collections` -- a path its route never gets to
 * answer. The two calls being on the correct sides of `parseRestRoute` is the
 * whole guarantee, and nothing about either call says so on its own.
 *
 * Read out of the source, like the direct-dispatch cold-boot list beside it,
 * because the property is an ORDER between three statements and no assertion
 * about one of them can see it.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(
  fileURLToPath(new URL("../routeHandler.ts", import.meta.url)),
  "utf8"
);

/** Where each mount's pass is consulted, by index into the source. */
function passIndexes(): Record<string, number> {
  const found: Record<string, number> = {};
  for (const m of SOURCE.matchAll(
    /reachPluginRoute\([^)]*?"(plugin|root)"/gs
  )) {
    found[m[1] as string] = m.index;
  }
  return found;
}

function coreRoutingIndex(): number {
  return SOURCE.indexOf("= parseRestRoute(");
}

describe("when each plugin route mount is consulted", () => {
  it("finds both passes and the core router, so an order cannot pass vacuously", () => {
    // The control. Two indexes that were never found would both be `undefined`
    // and compare in whatever direction the operator happened to take them.
    const passes = passIndexes();
    expect(Object.keys(passes).sort()).toEqual(["plugin", "root"]);
    expect(coreRoutingIndex()).toBeGreaterThan(-1);
  });

  it("matches namespaced routes before the built-in router", () => {
    expect(passIndexes().plugin).toBeLessThan(coreRoutingIndex());
  });

  it("matches root routes only after the built-in router declines", () => {
    expect(passIndexes().root).toBeGreaterThan(coreRoutingIndex());
  });
});
