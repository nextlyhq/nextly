import { afterEach, describe, expect, it, vi } from "vitest";

import { en } from "./en";

describe("the admin's own catalog", () => {
  it("keeps every key under the segment startup reserves for it", () => {
    // Startup refuses a plugin slugged `nextly` that declares translations,
    // and every other plugin's keys begin with its own slug, so this segment
    // is what keeps a plugin key from ever being one of these.
    const keys = Object.keys(en);
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.filter(key => !key.startsWith("nextly."))).toEqual([]);
  });

  describe("the development-only error labels", () => {
    afterEach(() => {
      vi.unstubAllEnvs();
      vi.resetModules();
    });

    async function catalogBuiltFor(mode: string) {
      vi.stubEnv("NODE_ENV", mode);
      vi.resetModules();
      return (await import("./en")).en;
    }

    it("are empty in a production build, so their text does not ship", async () => {
      const built = await catalogBuiltFor("production");
      expect(built["nextly.errors.page.details"]).toBe("");
      expect(built["nextly.errors.section.details"]).toBe("");
    });

    it("read as labels in development, where the boxes are drawn", async () => {
      const built = await catalogBuiltFor("development");
      expect(built["nextly.errors.page.details"]).toBe(
        "View technical details"
      );
      expect(built["nextly.errors.section.details"]).toBe("Error details");
    });
  });
});
