/**
 * How long the editor waits before recording a recovery point, read from the
 * entity's own versions configuration.
 */
import { describe, expect, it } from "vitest";

import { autosaveEnabledFor, autosaveIntervalFrom } from "../autosave-interval";

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

  it("accepts the longest delay a browser timer holds", () => {
    expect(
      autosaveIntervalFrom({
        versions: { drafts: { autosave: { intervalMs: 2_147_483_647 } } },
      })
    ).toBe(2_147_483_647);
  });

  it("leaves the editor's own default when nothing usable is configured", () => {
    expect(autosaveIntervalFrom(undefined)).toBeUndefined();
    expect(autosaveIntervalFrom({})).toBeUndefined();
    expect(autosaveIntervalFrom({ versions: null })).toBeUndefined();
    expect(
      autosaveIntervalFrom({ versions: { drafts: { autosave: {} } } })
    ).toBeUndefined();
    // A value no timer can honour is not an instruction.
    // 2147483648 is one past the longest delay a browser timer holds; it
    // would overflow and fire almost at once.
    for (const intervalMs of [0, -1, Number.NaN, "5000", 2_147_483_648]) {
      expect(
        autosaveIntervalFrom({
          versions: { drafts: { autosave: { intervalMs } } },
        })
      ).toBeUndefined();
    }
  });
});

describe("autosaveEnabledFor", () => {
  it("is true only where the configuration turns recovery points on", () => {
    expect(
      autosaveEnabledFor({
        versions: { drafts: { autosave: { enabled: true, intervalMs: 5000 } } },
      })
    ).toBe(true);
    expect(
      autosaveEnabledFor({
        versions: { drafts: { autosave: { enabled: false } } },
      })
    ).toBe(false);
    expect(
      autosaveEnabledFor({ versions: { drafts: { enabled: true } } })
    ).toBe(false);
    expect(autosaveEnabledFor({ versions: null })).toBe(false);
    expect(autosaveEnabledFor(null)).toBe(false);
  });
});
