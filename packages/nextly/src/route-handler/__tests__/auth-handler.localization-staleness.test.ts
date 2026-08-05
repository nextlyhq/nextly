// The dev-only staleness decision behind ensureServicesInitialized's
// re-registration: services capture `localization` at construction, so a
// later edit to that block has to be noticed.
//
// The comparison is against the ROUTE config's own previous value, not the
// container's. `registerServices` stores the plugin-TRANSFORMED config, so an
// app whose plugin supplies or normalizes `localization` would show a
// permanent difference there and rebuild its services on every request. The
// first observation therefore adopts whatever is stored as the baseline, and
// only a move away from that baseline counts.
//
// Written as one ordered walk because the baseline is module state that the
// real flow advances at registration time, which a unit test cannot perform:
// splitting these into separate cases would assert against whatever the
// previous case happened to leave behind.

import { describe, expect, it } from "vitest";

import type { SanitizedNextlyConfig } from "../../collections/config/define-config";
import { _localizationBlockChangedForTest } from "../auth-handler";

const LOCALIZATION = {
  locales: [{ code: "en", label: "English", rtl: false, fallbackLocale: [] }],
  defaultLocale: "en",
  fallback: true,
};

function storedWith(localization: unknown): SanitizedNextlyConfig {
  return { localization } as SanitizedNextlyConfig;
}

describe("localization staleness decision", () => {
  it("adopts what it first sees, then reports only moves away from it", () => {
    const changed = _localizationBlockChangedForTest;

    // 1. Nothing recorded yet. A registration this module did not make (an
    //    instrumentation boot) must not be torn down on the first request.
    expect(changed(storedWith(LOCALIZATION))).toBe(false);

    // 2. Asked repeatedly with the same block, it stays quiet — this is the
    //    property a comparison against the transformed config cannot hold.
    expect(changed(storedWith(LOCALIZATION))).toBe(false);
    expect(changed(storedWith(LOCALIZATION))).toBe(false);

    // 3. The block moves: the locale set widens.
    const widened = {
      ...LOCALIZATION,
      locales: [
        ...LOCALIZATION.locales,
        { code: "de", label: "German", rtl: false, fallbackLocale: [] },
      ],
    };
    expect(changed(storedWith(widened))).toBe(true);

    // 4. Removing the block entirely is a change too, not an absence to
    //    ignore — the baseline is still the adopted one until a
    //    re-registration records a new value.
    expect(changed(storedWith(undefined))).toBe(true);

    // 5. Back to the adopted block: nothing to do.
    expect(changed(storedWith(LOCALIZATION))).toBe(false);
  });
});
