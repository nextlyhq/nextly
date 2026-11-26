/**
 * A translated unique field the newest snapshot does not record, on per-language storage, as every
 * installation runs (`uniqueRecordCases`).
 */
import { vi } from "vitest";

import { perLanguageStorageSuite } from "../../../__tests__/storage-layout";

import { uniqueRecordCases } from "./helpers/unique-record-cases";

perLanguageStorageSuite();

const loaded = vi.hoisted(() => ({ config: undefined as unknown }));
vi.mock("../../utils/config-loader", async importOriginal => ({
  ...(await importOriginal<typeof import("../../utils/config-loader")>()),
  loadConfig: async () => ({ config: loaded.config, dependencies: [] }),
}));

uniqueRecordCases(loaded, "on per-language storage", true);
