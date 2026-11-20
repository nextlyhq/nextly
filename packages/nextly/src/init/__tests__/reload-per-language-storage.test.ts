/**
 * A reload reads `experimental.perLanguageStorage` as the start does: as a deprecated setting that
 * chooses nothing. Every installation keeps its translatable fields per language, so a reloaded
 * config that sets it either way leaves the running site's layout as it was and refuses nothing.
 *
 * The plausible broken reloads: one that still adopts the setting (turning the layout off under a
 * running site whose tables are laid out per language), and one that still refuses the reload.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  _resetPerLanguageStorage,
  perLanguageStorageEnabled,
} from "../../domains/i18n/per-language-storage";
import { consoleLogger } from "../../shared/types";
import { reloadNextlyConfig } from "../reload-config";
import { perLanguageStorageSuite } from "../../__tests__/storage-layout";

// Written for per-language storage as every installation runs it (`storage-layout`).
perLanguageStorageSuite();

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
  _resetPerLanguageStorage();
  delete reloadGlobals.__nextly_reloadInFlight;
  delete reloadGlobals.__nextly_reloadQueued;
});

/** What the reload warned, with the setting `perLanguageStorage` in the reloaded config. */
async function reloadWith(perLanguageStorage: boolean): Promise<string[]> {
  loadConfig.mockResolvedValue({
    config: { collections: [], perLanguageStorage },
    configPath: "/tmp/nextly.config.ts",
  });
  const warn = vi.spyOn(consoleLogger, "warn").mockImplementation(() => {});
  await reloadNextlyConfig();
  return warn.mock.calls.map(call => String(call[0]));
}

describe("a reload and the per-language storage setting", () => {
  it.each([true, false])(
    "keeps every translatable field per language with the setting %s, refusing nothing",
    async setting => {
      expect(perLanguageStorageEnabled()).toBe(true);
      const warnings = await reloadWith(setting);
      expect(perLanguageStorageEnabled()).toBe(true);
      expect(warnings.some(w => /chosen when the site starts/.test(w))).toBe(
        false
      );
      // The reload went through: the loader was read.
      expect(loadConfig).toHaveBeenCalled();
    }
  );
});
