/**
 * `nextly migrate:create` and a field renamed in code, on the earlier layout: the cases shared
 * with the per-language suite (`code-rename-cases`).
 */
import { vi } from "vitest";

import { codeRenameCases } from "./helpers/code-rename-cases";

/** The configuration the commands load, set by each step before it runs them. */
const loaded = vi.hoisted(() => ({ config: undefined as unknown }));
vi.mock("../../utils/config-loader", async importOriginal => ({
  ...(await importOriginal<typeof import("../../utils/config-loader")>()),
  loadConfig: async () => ({ config: loaded.config, dependencies: [] }),
}));

codeRenameCases({ layout: "earlier", loaded });
