import { describe, expect, it } from "vitest";

import type { RateLimitStore } from "../../../middleware/rate-limit";
import type { LimitStore } from "../limit-store";
import { limitsInMemoryWarning } from "../limits-in-memory-warning";

/**
 * The warning a production start gives while its limits count in one
 * process's memory, in each configuration a site can have.
 */

const legacy: RateLimitStore = {
  increment: async () => ({ count: 1, resetTime: 0 }),
  reset: async () => {},
};
const shared: LimitStore = {
  shared: true,
  update: async () => undefined as never,
  read: async () => new Map(),
  sweep: async () => 0,
};

/** The sanitized config a site with these settings boots with. */
const config = (rateLimit: Record<string, unknown>) => ({ rateLimit });

describe("limitsInMemoryWarning", () => {
  it("warns in production with every limit in memory, naming both settings", () => {
    const warning = limitsInMemoryWarning(
      config({ limitStore: "memory", singleInstance: false }),
      true
    );
    expect(warning).toContain('rateLimit.store: "database"');
    expect(warning).toContain("rateLimit.singleInstance");
  });

  it("says nothing outside production", () => {
    expect(
      limitsInMemoryWarning(config({ limitStore: "memory" }), false)
    ).toBeNull();
  });

  it("says nothing once the site says it runs one instance", () => {
    expect(
      limitsInMemoryWarning(
        config({ limitStore: "memory", singleInstance: true }),
        true
      )
    ).toBeNull();
  });

  it("says nothing with the database store", () => {
    expect(
      limitsInMemoryWarning(config({ limitStore: "database" }), true)
    ).toBeNull();
  });

  it("says nothing with an app's own shared limit store", () => {
    expect(
      limitsInMemoryWarning(config({ limitStore: shared }), true)
    ).toBeNull();
  });

  it("warns with an app's own limit store that says it is not shared", () => {
    expect(
      limitsInMemoryWarning(
        config({ limitStore: { ...shared, shared: false } }),
        true
      )
    ).toContain('rateLimit.store: "database"');
  });

  it("says plugin limits run in memory with only a store of the older contract", () => {
    const warning = limitsInMemoryWarning(
      config({ limitStore: "memory", store: legacy }),
      true
    );
    // Says which limits are in memory: the plugin limits, not core's own,
    // which the app's store serves. The every-limit warning would not.
    expect(warning).toContain("Plugin limits count in this process's memory");
    expect(warning).toContain("serves core's own limits");
    expect(warning).toContain('rateLimit.store: "database"');
    expect(warning).toContain("rateLimit.singleInstance");
  });
});
