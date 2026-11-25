/**
 * A field the database keeps unique, moved into a group or a repeater in code, as `migrate:create`
 * refuses it
 * (`describeRefusedCodeMoves`).
 */
import { vi } from "vitest";

import { describeRefusedCodeMoves } from "./migrate-create-refused-moves-suite";

/** The configuration the commands load, set by each step before it runs them. */
const loaded = vi.hoisted(() => ({ config: undefined as unknown }));
vi.mock("../../utils/config-loader", async importOriginal => ({
  ...(await importOriginal<typeof import("../../utils/config-loader")>()),
  loadConfig: async () => ({ config: loaded.config, dependencies: [] }),
}));

describeRefusedCodeMoves(loaded);
