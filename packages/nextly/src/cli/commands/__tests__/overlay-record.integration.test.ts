/**
 * A translated entity's group of text and its overlay column, on the earlier layout, as the suites
 * run by default (`overlayRecordCases`).
 */
import { vi } from "vitest";

import { overlayRecordCases } from "./helpers/overlay-record-cases";

const loaded = vi.hoisted(() => ({ config: undefined as unknown }));
vi.mock("../../utils/config-loader", async importOriginal => ({
  ...(await importOriginal<typeof import("../../utils/config-loader")>()),
  loadConfig: async () => ({ config: loaded.config, dependencies: [] }),
}));

overlayRecordCases(loaded, "on the earlier layout", false);
