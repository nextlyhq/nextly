/**
 * A reload that would turn per-language storage on or off is refused, and the running site keeps
 * the config it was serving: its tables were laid out for the choice it started with.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  perLanguageStorageEnabled,
  setPerLanguageStorage,
} from "../../domains/i18n/per-language-storage";
import { consoleLogger } from "../../shared/types";
import { reloadNextlyConfig } from "../reload-config";

const loadConfig = vi.hoisted(() => vi.fn());
vi.mock("../../cli/utils/config-loader", () => ({
  loadConfig,
  clearConfigCache: () => undefined,
}));
// A reload watches the files the config it read reaches; nothing here is on disk.
vi.mock("../../runtime/hmr-listener", () => ({
  watchLoadedConfig: () => undefined,
  watchScannedConfig: async () => undefined,
}));

const reloadGlobals = globalThis as unknown as {
  __nextly_reloadInFlight?: Promise<void>;
  __nextly_reloadQueued?: Promise<void>;
};

afterEach(() => {
  vi.restoreAllMocks();
  loadConfig.mockReset();
  setPerLanguageStorage(false);
  delete reloadGlobals.__nextly_reloadInFlight;
  delete reloadGlobals.__nextly_reloadQueued;
});

/** What the reload told the developer it refused, if anything. */
async function reloadWith(perLanguageStorage: boolean): Promise<string[]> {
  loadConfig.mockResolvedValue({
    config: { collections: [], perLanguageStorage },
    configPath: "/tmp/nextly.config.ts",
  });
  const warn = vi.spyOn(consoleLogger, "warn").mockImplementation(() => {});
  await reloadNextlyConfig();
  return warn.mock.calls.map(call => String(call[0]));
}

describe("a reload and per-language storage", () => {
  it("refuses a config that turns it on, keeping the site as it started", async () => {
    const warnings = await reloadWith(true);
    expect(
      warnings.some(w =>
        /perLanguageStorage is chosen when the site starts/.test(w)
      )
    ).toBe(true);
    expect(perLanguageStorageEnabled()).toBe(false);
  });

  it("refuses a config that turns it off", async () => {
    setPerLanguageStorage(true);
    const warnings = await reloadWith(false);
    expect(
      warnings.some(w =>
        /perLanguageStorage is chosen when the site starts/.test(w)
      )
    ).toBe(true);
    expect(perLanguageStorageEnabled()).toBe(true);
  });

  it("goes on with a config that keeps it", async () => {
    setPerLanguageStorage(true);
    const warnings = await reloadWith(true);
    expect(warnings.some(w => /perLanguageStorage/.test(w))).toBe(false);
  });
});
