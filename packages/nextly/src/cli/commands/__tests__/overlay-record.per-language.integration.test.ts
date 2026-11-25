/**
 * A translated entity's group of text and its overlay column, on per-language storage, as every
 * installation runs (`overlayRecordCases`).
 */
import { vi } from "vitest";

import { perLanguageStorageSuite } from "../../../__tests__/storage-layout";

import { overlayRecordCases } from "./helpers/overlay-record-cases";

perLanguageStorageSuite();

const loaded = vi.hoisted(() => ({ config: undefined as unknown }));
vi.mock("../../utils/config-loader", async importOriginal => ({
  ...(await importOriginal<typeof import("../../utils/config-loader")>()),
  loadConfig: async () => ({ config: loaded.config, dependencies: [] }),
}));

overlayRecordCases(loaded, "on per-language storage", true);
