// The dev-only staleness decision behind ensureServicesInitialized's
// re-registration: services capture `localization` at construction, so a
// later edit to that block has to be noticed.
//
// The comparison is against the ROUTE config's own previous value, not the
// container's. `registerServices` stores the plugin-TRANSFORMED config, so an
// app whose plugin supplies or normalizes `localization` would show a
// permanent difference there and rebuild its services on every request.
//
// Written as one ordered walk because the baseline is module state that the
// real flow advances at registration time: splitting these into separate
// cases would assert against whatever the previous case left behind.

import { describe, expect, it } from "vitest";

import type { SanitizedNextlyConfig } from "../../collections/config/define-config";
import {
  _localizationBlockChangedForTest,
  _recordRegisteredLocalizationForTest,
} from "../auth-handler";

const LOCALIZATION = {
  locales: [{ code: "en", label: "English", rtl: false, fallbackLocale: [] }],
  defaultLocale: "en",
  fallback: true,
};

function storedWith(localization: unknown): SanitizedNextlyConfig {
  return { localization } as SanitizedNextlyConfig;
}

describe("localization staleness decision", () => {
  it("rebuilds once for an unverifiable registration, then only on real moves", () => {
    const changed = _localizationBlockChangedForTest;

    // 1. No baseline. Callers reach this only once services are registered,
    //    and this module records a baseline whenever IT registers them — so
    //    no baseline means another path did (an instrumentation.ts boot),
    //    holding a `localization` this module never saw. The config may have
    //    been edited before the first request arrived, so the honest answer
    //    is "cannot verify", and that has to mean rebuild.
    expect(changed(storedWith(LOCALIZATION))).toBe(true);

    // Re-registering is what records the baseline; the decision function
    // deliberately does not write it. Standing in for that step here is what
    // makes the rest of the walk represent the real sequence.
    _recordRegisteredLocalizationForTest(storedWith(LOCALIZATION));

    // 2. Now verifiable and unchanged — and it must STAY quiet on repeats.
    //    This is the property a comparison against the container's
    //    plugin-transformed config cannot hold, and it is why the single
    //    rebuild above cannot become a loop.
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
    //    ignore — the baseline stays put until a re-registration moves it.
    expect(changed(storedWith(undefined))).toBe(true);

    // 5. Back to the recorded block: nothing to do.
    expect(changed(storedWith(LOCALIZATION))).toBe(false);
  });
});
