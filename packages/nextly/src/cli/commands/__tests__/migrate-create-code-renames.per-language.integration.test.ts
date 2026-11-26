/**
 * `nextly migrate:create` and a field renamed in code, on per-language storage as every
 * installation runs it: the cases shared with the earlier layout's suite (`code-rename-cases`).
 */
import { vi } from "vitest";

import { perLanguageStorageSuite } from "../../../__tests__/storage-layout";

import { codeRenameCases } from "./helpers/code-rename-cases";

perLanguageStorageSuite();

/** The configuration the commands load, set by each step before it runs them. */
const loaded = vi.hoisted(() => ({ config: undefined as unknown }));
vi.mock("../../utils/config-loader", async importOriginal => ({
  ...(await importOriginal<typeof import("../../utils/config-loader")>()),
  loadConfig: async () => ({ config: loaded.config, dependencies: [] }),
}));

codeRenameCases({ layout: "per-language", loaded });
