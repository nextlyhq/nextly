/**
 * The development server's block of the changes not yet in a migration, on the earlier storage layout, which most suites run on
 * (`devDriftBlockCases`).
 */
import { vi } from "vitest";

import { devDriftBlockCases } from "./helpers/dev-drift-block-cases";

const loaded = vi.hoisted(() => ({ config: undefined as unknown }));

// `../program` imports every command; the commands under test are handed their context.
vi.mock("../../program", () => ({ createContext: () => ({ logger: {} }) }));

// The configuration a reload and the commands read, as the project's file would give it.
vi.mock("../../utils/config-loader", async importOriginal => ({
  ...(await importOriginal<typeof import("../../utils/config-loader")>()),
  loadConfig: async () => ({
    config: loaded.config,
    configPath: "",
    dependencies: [],
  }),
}));

devDriftBlockCases(loaded, "on the earlier storage layout");
