// Why: one normalizer owns the switch-to-column mapping, so the persistence
// sites cannot drift the way a hand-rolled ternary at each site would.
// Recording is the default, so only the opt-out ever occupies the column.
import { describe, expect, it } from "vitest";

import { resolveBuilderWebhooks } from "../builder-webhooks";

describe("resolveBuilderWebhooks", () => {
  it("stores the opt-out when the switch is off", () => {
    expect(resolveBuilderWebhooks(false)).toEqual({ record: false });
  });

  it("stores nothing when the switch is on", () => {
    expect(resolveBuilderWebhooks(true)).toBeNull();
  });

  it("stores nothing when the switch was never touched", () => {
    expect(resolveBuilderWebhooks(undefined)).toBeNull();
  });
});
