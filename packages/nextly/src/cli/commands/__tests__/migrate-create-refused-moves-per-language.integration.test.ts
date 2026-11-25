/**
 * A field the database keeps unique, moved into a group or a repeater in code, as `migrate:create`
 * refuses it, on the storage layout every installation runs: values kept for each language
 * (`describeRefusedCodeMoves`).
 */
import { vi } from "vitest";
import { perLanguageStorageSuite } from "../../../__tests__/storage-layout";

import { describeRefusedCodeMoves } from "./migrate-create-refused-moves-suite";

perLanguageStorageSuite();

/** The configuration the commands load, set by each step before it runs them. */
const loaded = vi.hoisted(() => ({ config: undefined as unknown }));
vi.mock("../../utils/config-loader", async importOriginal => ({
  ...(await importOriginal<typeof import("../../utils/config-loader")>()),
  loadConfig: async () => ({ config: loaded.config, dependencies: [] }),
}));

describeRefusedCodeMoves(loaded);
