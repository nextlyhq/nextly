import { describe, expect, it, vi } from "vitest";

const booted = vi.hoisted(() => ({ instance: null as unknown }));

vi.mock("@nextlyhq/plugin-sdk", () => ({
  getCachedNextly: () =>
    booted.instance === null
      ? Promise.reject(new Error("nothing registered"))
      : Promise.resolve(booted.instance),
}));

import { PAGE_BUILDER_PLUGIN_NAME } from "./library-contract";
import { bootedSpacingModeReader } from "./spacing-mode-booted";
import {
  SPACING_MODE_SERVICE,
  spacingModeReaderOf,
} from "./spacing-mode-reader";
import { readStoredSiteStyle } from "./site-style-storage";

describe("spacingModeReaderOf", () => {
  it("reads the model through the plugin's service, called on the service", async () => {
    const service = {
      mode: "classic" as const,
      read() {
        return Promise.resolve(this.mode);
      },
    };
    const reader = spacingModeReaderOf({
      plugins: {
        [PAGE_BUILDER_PLUGIN_NAME]: { [SPACING_MODE_SERVICE]: service },
      },
    });
    expect(await reader?.read()).toBe("classic");
  });

  it("offers no reader when the instance has no services or not this one", () => {
    expect(spacingModeReaderOf({})).toBeUndefined();
    expect(
      spacingModeReaderOf({ plugins: { [PAGE_BUILDER_PLUGIN_NAME]: {} } })
    ).toBeUndefined();
    expect(
      spacingModeReaderOf({
        plugins: {
          [PAGE_BUILDER_PLUGIN_NAME]: { [SPACING_MODE_SERVICE]: { read: 1 } },
        },
      })
    ).toBeUndefined();
  });
});

describe("a reader with no plugin services", () => {
  const instance = (mode: string) => ({
    plugins: {
      [PAGE_BUILDER_PLUGIN_NAME]: {
        [SPACING_MODE_SERVICE]: { read: () => Promise.resolve(mode) },
      },
    },
  });

  it("reads the model from the instance this process booted", async () => {
    booted.instance = instance("classic");
    // The documented route's reader: the Single's read and nothing else, with
    // the booted reader a server path hands in.
    const stored = await readStoredSiteStyle({
      nextly: { findSingle: () => Promise.resolve(null) },
      bootedReader: bootedSpacingModeReader,
    });
    expect(stored.spacingMode).toBe("classic");
    // Without one, nothing is read past the reader it was handed: the module
    // browser entries reach never loads the booted instance itself.
    const alone = await readStoredSiteStyle({
      nextly: { findSingle: () => Promise.resolve(null) },
    });
    expect(alone.spacingMode).toBeNull();
  });

  it("reads the model from an instance the reader's own document read booted", async () => {
    booted.instance = null;
    // A lazy reader, as a route builds it: its first read boots the instance.
    const lazy = {
      findSingle: async () => {
        booted.instance = instance("classic");
        return null;
      },
    };
    const stored = await readStoredSiteStyle({
      nextly: lazy,
      bootedReader: bootedSpacingModeReader,
    });
    expect(stored.spacingMode).toBe("classic");
  });

  it("prefers the reader's own services to the booted instance", async () => {
    booted.instance = instance("classic");
    const stored = await readStoredSiteStyle({
      nextly: { findSingle: () => Promise.resolve(null), ...instance("gaps") },
    });
    expect(stored.spacingMode).toBe("gaps");
  });

  it("answers no reader, rather than failing, when nothing has booted", async () => {
    booted.instance = null;
    expect(await bootedSpacingModeReader()).toBeUndefined();
  });
});
