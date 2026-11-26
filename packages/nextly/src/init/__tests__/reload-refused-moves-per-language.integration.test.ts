/**
 * A field the database keeps unique, moved into a group or a repeater in a code-first config, as a
 * config reload under `next dev` refuses it, on the storage layout every installation runs: values kept for each language
 * (`describeRefusedReloads`).
 */
import { vi } from "vitest";
import { perLanguageStorageSuite } from "../../__tests__/storage-layout";

import { describeRefusedReloads } from "./reload-refused-moves-suite";

perLanguageStorageSuite();

/** The configuration the reload loads, set by each step before it. */
const loaded = vi.hoisted(() => ({ config: undefined as unknown }));
vi.mock("../../cli/utils/config-loader", async importOriginal => ({
  ...(await importOriginal<typeof import("../../cli/utils/config-loader")>()),
  loadConfig: async () => ({
    config: loaded.config,
    configPath: "",
    dependencies: [],
  }),
}));

describeRefusedReloads(loaded);
