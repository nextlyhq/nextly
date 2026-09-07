import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import * as registrations from "../index";

/**
 * A registration nothing calls is how document locking came to ship as three
 * unused tables: the domain, its schemas and its tests were all present and
 * complete, and the orchestrator never invoked them, so no consumer could
 * reach any of it.
 *
 * Asserted against the orchestrator's source because that is where the calls
 * are. Constructing the real context would exercise every other domain to
 * learn one fact about this one.
 */
const orchestrator = readFileSync(
  new URL("../../register.ts", import.meta.url),
  "utf-8"
);

/** Exports that register something, as opposed to resets and type re-exports. */
const registrars = Object.keys(registrations).filter(name =>
  name.startsWith("register")
);

describe("the DI orchestrator", () => {
  it("exports registrations to check, so this cannot pass on an empty list", () => {
    // The control. An absence test over nothing is satisfied by everything.
    expect(registrars.length).toBeGreaterThan(10);
  });

  it("calls every registration the barrel exports", () => {
    const uncalled = registrars.filter(
      name => !orchestrator.includes(`${name}(ctx)`)
    );

    expect(uncalled).toEqual([]);
  });
});
