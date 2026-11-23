/**
 * One configuration edit carried through `migrate:check`, `nextly migrate` and
 * `migrate:create`, on the earlier storage layout, which most suites run on (`pendingChangesRoundTrip`).
 */
import { vi } from "vitest";

import { pendingChangesRoundTrip } from "./helpers/pending-changes-round-trip";

const loaded = vi.hoisted(() => ({ config: undefined as unknown }));
vi.mock("../../utils/config-loader", async importOriginal => ({
  ...(await importOriginal<typeof import("../../utils/config-loader")>()),
  loadConfig: async () => ({ config: loaded.config, dependencies: [] }),
}));

pendingChangesRoundTrip(loaded, "on the earlier storage layout");
