/**
 * The registry always writes a `versions` property and sets it to null when the
 * entity is unversioned. Reading `versions?.enabled` alone collapses that into
 * the same `undefined` as a payload that says nothing, which is what made every
 * unversioned document offer history.
 */
import { describe, it, expect } from "vitest";

import { historyEnabledFrom } from "../history-enabled";

describe("historyEnabledFrom", () => {
  it("reports enabled when the entity records versions", () => {
    expect(historyEnabledFrom({ versions: { enabled: true } })).toBe(true);
  });

  it("reports disabled for an unversioned entity", () => {
    // The distinguishing case: present, but null.
    expect(historyEnabledFrom({ versions: null })).toBe(false);
  });

  it("reports disabled when versioning is present but off", () => {
    expect(historyEnabledFrom({ versions: { enabled: false } })).toBe(false);
  });

  it("reports unknown when the payload says nothing about versioning", () => {
    // Distinct from `versions: null`. Answering "no" here would hide the
    // feature wherever a payload simply omits the property.
    expect(historyEnabledFrom({ slug: "posts" })).toBeUndefined();
  });

  it("reports unknown for a value that is not a schema", () => {
    expect(historyEnabledFrom(null)).toBeUndefined();
    expect(historyEnabledFrom(undefined)).toBeUndefined();
    expect(historyEnabledFrom("posts")).toBeUndefined();
  });
});
