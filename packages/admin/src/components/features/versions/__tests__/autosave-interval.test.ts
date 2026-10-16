/**
 * How long the editor waits before recording a recovery point, read from the
 * entity's own versions configuration.
 */
import { describe, expect, it } from "vitest";

import { autosaveIntervalFrom } from "../autosave-interval";

describe("autosaveIntervalFrom", () => {
  it("reads the configured interval", () => {
    expect(
      autosaveIntervalFrom({
        versions: {
          enabled: true,
          drafts: {
            enabled: true,
            autosave: { enabled: true, intervalMs: 5000 },
          },
        },
      })
    ).toBe(5000);
  });

  it("leaves the editor's own default when nothing usable is configured", () => {
    expect(autosaveIntervalFrom(undefined)).toBeUndefined();
    expect(autosaveIntervalFrom({})).toBeUndefined();
    expect(autosaveIntervalFrom({ versions: null })).toBeUndefined();
    expect(
      autosaveIntervalFrom({ versions: { drafts: { autosave: {} } } })
    ).toBeUndefined();
    // A value no timer can honour is not an instruction.
    for (const intervalMs of [0, -1, Number.NaN, "5000"]) {
      expect(
        autosaveIntervalFrom({
          versions: { drafts: { autosave: { intervalMs } } },
        })
      ).toBeUndefined();
    }
  });
});
