import { describe, expect, it } from "vitest";

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
});
