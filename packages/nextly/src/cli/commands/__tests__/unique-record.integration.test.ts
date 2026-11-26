/**
 * A translated unique field the newest snapshot does not record, on the earlier layout, as the
 * suites run by default (`uniqueRecordCases`).
 */
import { vi } from "vitest";

import { uniqueRecordCases } from "./helpers/unique-record-cases";

const loaded = vi.hoisted(() => ({ config: undefined as unknown }));
vi.mock("../../utils/config-loader", async importOriginal => ({
  ...(await importOriginal<typeof import("../../utils/config-loader")>()),
  loadConfig: async () => ({ config: loaded.config, dependencies: [] }),
}));

uniqueRecordCases(loaded, "on the earlier layout", false);
